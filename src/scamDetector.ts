/**
 * scamDetector.ts
 * AI 사기 메시지 방패 — V2 탐지 엔진 (standalone)
 *
 * DAY5: 규칙 기반 클라이언트 엔진. 외부 API·네트워크·시크릿 전혀 없음.
 * 같은 입력을 넣으면 항상 같은 출력이 나오는 결정론적(순수 함수) 모듈입니다.
 *
 * DAY8~9 V2 개선:
 *   - 고위험 키워드 티어(highRiskPatterns / highRiskBonus): 신호 내 강한 하위 패턴을 별도 KB로 관리.
 *     실제 신고 사례 키워드를 참고해 확장하는 RAG식 구조(로컬 배열, 외부 호출 없음).
 *   - 콤보 보너스 확대: money+pressure(+8), offPlatform+tooGood(+12), impersonation+pressure(+8) 추가.
 *   - 임계값(45)·기존 단일 가중치 체계 유지 → 정상 문자 오탐 방지.
 *
 * DAY10 가드레일:
 *   - 신호 excerpt(발췌)에 PII 마스킹 적용: 전화번호·계좌번호·주민번호·카드번호를 가운데 *** 처리.
 *     분류 로직(점수·등급) 자체는 변경하지 않는다.
 */

// ---------------------------------------------------------------------------
// DAY10: PII 마스킹 인라인 구현
// ---------------------------------------------------------------------------
// guardrails.mjs 는 Node ESM 전용이므로 TS 환경에서는 동일 로직을 인라인으로 둔다.
// 두 구현이 동일한 동작을 해야 함 — 규칙 변경 시 guardrails.mjs 와 함께 수정할 것.

/**
 * 텍스트 내 PII(개인식별정보)를 마스킹한다.
 *   - 전화번호(01X-XXX(X)-XXXX): 가운데 국번을 **** 로
 *   - 카드번호(4-4-4-4): 두 번째 그룹부터 ****
 *   - 주민등록번호(6-7): 뒷 7자리를 *******
 *   - 계좌번호(2~6자리-2~8자리-2~8자리): 가운데 그룹을 ***
 */
function maskPIIInternal(text: string): string {
  let result = text;

  // 카드번호: 4-4-4-4 형식 (가장 구체적 패턴 우선)
  result = result.replace(/\b(\d{4})-(\d{4})-(\d{4})-(\d{4})\b/g, "$1-****-****-****");

  // 주민등록번호: 6자리-7자리
  result = result.replace(/\b(\d{6})-(\d{7})\b/g, "$1-*******");

  // 전화번호: 01X-XXX(X)-XXXX
  result = result.replace(
    /\b(01\d)-(\d{3,4})-(\d{4})\b/g,
    (_match: string, p1: string, p2: string, p3: string) =>
      `${p1}-${"*".repeat(p2.length)}-${p3}`
  );

  // 계좌번호: 숫자(2~6)-숫자(2~8)-숫자(2~8) (전화/카드/주민번호 이후 남은 것만)
  result = result.replace(
    /\b(\d{2,6})-(\d{2,8})-(\d{2,8})\b/g,
    (_match: string, p1: string, p2: string, p3: string) => {
      if (_match.includes("*")) return _match;
      return `${p1}-${"*".repeat(p2.length)}-${p3}`;
    }
  );

  return result;
}

// ---------------------------------------------------------------------------
// 공개 타입 정의
// ---------------------------------------------------------------------------

/** 위험 등급 — 점수에 따라 네 단계로 나뉩니다 */
export type RiskLevel = "안전" | "주의" | "위험" | "매우위험";

/**
 * 탐지 신호 종류 — 7종 고정 키
 *  url          : 의심 링크·단축 URL
 *  money        : 선입금·계좌이체 등 금전 요구
 *  impersonation: 공공기관·기업 사칭
 *  pressure     : "지금 당장" 등 심리적 압박
 *  personalInfo : 인증번호·비밀번호 등 개인정보 요구
 *  offPlatform  : 안전결제 회피·직거래 유도
 *  tooGood      : 반값·원금보장 등 비현실적 조건
 */
export type SignalType =
  | "url"
  | "money"
  | "impersonation"
  | "pressure"
  | "personalInfo"
  | "offPlatform"
  | "tooGood";

/** 개별 위험 신호 */
export interface RiskSignal {
  /** 신호 종류 */
  type: SignalType;
  /** 사람이 읽기 쉬운 짧은 이름 */
  label: string;
  /** 실제 텍스트에서 매치된 주변 30자 */
  excerpt: string;
  /** 왜 위험한지 비전공자에게 설명하는 문장 */
  why: string;
  /** 이 신호가 점수에 기여하는 가중치 */
  weight: number;
}

/** detectScam() 최종 결과 */
export interface ScamResult {
  /** 0~100 위험 점수 */
  riskScore: number;
  /** 위험 등급 */
  level: RiskLevel;
  /** 발견된 신호 목록 (weight 내림차순) */
  signals: RiskSignal[];
  /** 한 줄 경고 메시지 */
  oneLineWarning: string;
  /** 탐지 요약 한 줄 */
  safeSummary: string;
  /**
   * DAY13: 위험 등급별 추천 행동 안내.
   * 분류 로직(점수·등급)에는 영향 없이 결과 표시 목적으로만 사용됩니다.
   */
  actionAdvice: string;
}

// ---------------------------------------------------------------------------
// 내부: 규칙 정의
// ---------------------------------------------------------------------------

interface Rule {
  type: SignalType;
  label: string;
  weight: number;
  why: string;
  patterns: RegExp[];
  /**
   * [V2] 고위험 하위 패턴 KB (RAG식 구조: 실제 신고 사례 키워드를 참고해 확장).
   * 이 패턴 중 하나라도 매치되면 weight + highRiskBonus 로 채점합니다.
   * 외부 호출 없이 로컬 배열로 관리합니다.
   */
  highRiskPatterns?: RegExp[];
  /** [V2] 고위험 패턴 매치 시 기본 weight 에 추가되는 보너스 점수 */
  highRiskBonus?: number;
}

/**
 * [V2] 고위험 키워드 KB (Knowledge Base) — 신고 사례 참고 확장.
 *
 * 아래 배열은 각 신호 유형별로 "강한 사기 신호"로 분류된 키워드 모음입니다.
 * 새 신고 사례가 들어오면 이 배열에 추가하는 방식으로 확장합니다(RAG식 구조).
 * 특정 케이스 텍스트를 하드코딩하지 않습니다 — 키워드 일반화만 허용합니다.
 *
 * 가중치 요약 (V2):
 *   url(18, 단축URL 고위험 +30=48) / money(22) / impersonation(20)
 *   pressure(16, 법적강제 고위험 +30=46) / personalInfo(22) / offPlatform(12)
 *   tooGood(12, 수익보장 고위험 +15=27)
 */
const RULES: Rule[] = [
  {
    type: "url",
    label: "의심스러운 링크",
    weight: 18,
    why: "낯선 주소·단축URL은 가짜 사이트로 유도하는 통로예요.",
    patterns: [
      /https?:\/\//i,
      /\b(bit\.ly|tinyurl|han\.gl|me2\.kr|buly\.kr|abr\.ge|url\.kr)\b/i,
      /[\w-]+\.(com|net|kr|xyz|top|click|link|vip|cc)\b/i,
    ],
    // [V2 고위험 KB] 단축 URL 서비스: 출처를 감추기 위한 리다이렉트 도구로 사기에 자주 악용됨.
    highRiskPatterns: [
      /\b(bit\.ly|tinyurl|han\.gl|me2\.kr|buly\.kr|abr\.ge|url\.kr)\b/i,
    ],
    highRiskBonus: 30, // 단축URL 단독 탐지 시 18+30=48 → 임계값 초과
  },
  {
    type: "money",
    label: "금전 요구",
    weight: 22,
    why: "선입금·계좌이체를 요구하면 거의 사기예요.",
    patterns: [
      /선입금|입금|계좌|송금|이체|보증금|예치금|수수료|대납|환전/,
      /\d{2,}-\d{2,}-\d{3,}/,
    ],
    // money 신호 자체는 고위험 하위 티어 없음 — 단독 금전 키워드는 정상 거래에도 등장.
  },
  {
    type: "impersonation",
    label: "기관 사칭",
    weight: 20,
    why: "공공기관·은행은 문자로 개인정보나 송금을 요구하지 않아요.",
    patterns: [
      /경찰|검찰|검사|금융감독원|금감원|국세청|법원|우체국|택배|관세청|세관|은행|고객센터|수사관|민원실|질병관리청/,
    ],
    // impersonation 단독은 20점 → 정상 배송 문자 등에서 오탐 방지를 위해 고위험 KB 미적용.
  },
  {
    type: "pressure",
    label: "심리적 압박",
    weight: 16,
    why: "'지금 당장'으로 급하게 몰면 판단을 흐리려는 수법이에요.",
    patterns: [
      /지금|즉시|당장|마감|한정|계정\s?정지|벌금|체포|영장|미납|연체|긴급|마지막/,
    ],
    // [V2 고위험 KB] 법적 강제 키워드: 실제 수사기관·법원은 문자로 이런 표현을 쓰지 않음.
    // 신고 사례 다수에서 "영장 발부", "체포", "구속", "계정정지", "압류", "벌금" 키워드 확인됨.
    highRiskPatterns: [
      /영장|체포|구속|계정\s?정지|압류|벌금/,
    ],
    highRiskBonus: 30, // 법적강제 단독 탐지 시 16+30=46 → 임계값 초과
  },
  {
    type: "personalInfo",
    label: "개인정보 요구",
    weight: 22,
    why: "인증번호·비밀번호·주민번호는 누구에게도 알려주면 안 돼요.",
    patterns: [
      /인증번호|인증\s?코드|otp|비밀번호|비번|주민(등록)?번호|카드\s?번호|cvc|보안카드|신분증/i,
    ],
  },
  {
    type: "offPlatform",
    label: "안전거래 회피",
    weight: 12,
    why: "안전결제를 피해 직거래·개인송금을 유도하면 위험해요.",
    patterns: [
      /직거래|카톡으로|문자로\s?연락|안전결제\s?(말고|없이|대신)|개인\s?거래/,
    ],
  },
  {
    type: "tooGood",
    label: "비현실적 조건",
    weight: 12,
    why: "'반값·원금보장·고수익'처럼 너무 좋은 조건은 미끼예요.",
    patterns: [
      /급처|급매|시세보다|반값|원금\s?보장|고수익|수익\s?보장|무조건|확정\s?수익|100%/,
    ],
    // [V2 고위험 KB] 수익 보장 류: 실제 금융상품에서 절대 허용되지 않는 표현.
    // 신고 사례에서 "원금보장", "수익보장", "고수익", "확정수익"이 리딩방 사기의 핵심 키워드로 반복 확인됨.
    highRiskPatterns: [
      /원금\s?보장|수익\s?보장|고수익|확정\s?수익/,
    ],
    highRiskBonus: 15, // 수익보장 매치 시 12+15=27점 (콤보와 결합해 임계값 초과 유도)
  },
];

// ---------------------------------------------------------------------------
// 내부 헬퍼: 매치 위치 주변 30자 발췌
// ---------------------------------------------------------------------------

/**
 * 매치 인덱스 기준 앞뒤 ~30자를 잘라 반환합니다.
 * 비전공자가 "어디서 걸렸는지" 바로 볼 수 있도록 합니다.
 */
function extractExcerpt(text: string, matchIndex: number, matchLength: number): string {
  const PAD = 30;
  const start = Math.max(0, matchIndex - PAD);
  const end = Math.min(text.length, matchIndex + matchLength + PAD);
  const snippet = text.slice(start, end);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return prefix + snippet + suffix;
}

// ---------------------------------------------------------------------------
// 내부 헬퍼: 한 줄 경고 생성
// ---------------------------------------------------------------------------

/**
 * 등급과 최상위 신호 종류를 조합해 비전공자가 바로 이해할 수 있는 경고문을 만듭니다.
 */
function buildOneLineWarning(level: RiskLevel, signals: RiskSignal[]): string {
  if (level === "안전") {
    return "뚜렷한 사기 신호는 없지만, 모르는 사람의 송금·링크 요구는 항상 의심하세요.";
  }

  const topType: SignalType | undefined = signals[0]?.type;

  const warningMap: Record<SignalType, string> = {
    personalInfo: "인증번호·비밀번호를 묻는 전형적 사기예요. 절대 입력하지 마세요.",
    money: "입금·계좌이체를 요구하고 있어요. 돈을 보내기 전에 반드시 확인하세요.",
    impersonation: "공공기관·기업을 사칭하는 메시지예요. 직접 공식 번호로 확인하세요.",
    url: "의심스러운 링크가 있어요. 절대 클릭하지 말고 주소를 직접 확인하세요.",
    pressure: "'지금 당장'이라며 급하게 몰고 있어요. 서두르지 말고 주변에 물어보세요.",
    offPlatform: "안전결제 밖으로 유도하고 있어요. 플랫폼 내 결제만 이용하세요.",
    tooGood: "너무 좋은 조건은 사기의 미끼예요. 섣불리 응하지 마세요.",
  };

  const levelPrefix: Record<Exclude<RiskLevel, "안전">, string> = {
    매우위험: "[매우위험] ",
    위험: "[위험] ",
    주의: "[주의] ",
  };

  const prefix = levelPrefix[level as Exclude<RiskLevel, "안전">];

  if (topType === undefined) {
    return prefix + "신중하게 판단하세요.";
  }

  return prefix + warningMap[topType];
}

// ---------------------------------------------------------------------------
// 내부 헬퍼: 요약 한 줄 생성
// ---------------------------------------------------------------------------

/**
 * 탐지된 신호 개수와 라벨을 조합해 한 줄 요약을 만듭니다.
 * 예) "위험 신호 3개 발견: 기관 사칭·개인정보 요구·의심스러운 링크"
 */
function buildSafeSummary(signals: RiskSignal[]): string {
  if (signals.length === 0) {
    return "사기 신호가 발견되지 않았습니다.";
  }
  const labels = signals.map((s) => s.label).join("·");
  return `위험 신호 ${signals.length}개 발견: ${labels}`;
}

// ---------------------------------------------------------------------------
// 내부 헬퍼: 추천 행동 안내 생성 (DAY13)
// ---------------------------------------------------------------------------

/**
 * DAY13: 위험 등급에 따라 사용자가 즉시 취해야 할 행동을 한 줄로 안내합니다.
 * 분류 로직(점수·등급)은 건드리지 않으며 출력 전용입니다.
 *
 * - 매우위험/위험: 즉각 차단·신고 행동 안내
 * - 주의: 출처 재확인 권고
 * - 안전: 일반 주의 사항 안내
 */
function buildActionAdvice(level: RiskLevel): string {
  if (level === "매우위험" || level === "위험") {
    return "응답·송금·링크 클릭을 멈추고, 기관/지인은 공식 번호로 직접 확인하세요. 이미 입력했다면 즉시 차단·신고(112/118)하세요.";
  }
  if (level === "주의") {
    return "바로 응하지 말고 출처를 한 번 더 확인하세요. 모르는 링크·계좌는 누르거나 보내지 마세요.";
  }
  // 안전
  return "특이 신호는 없지만, 모르는 사람의 송금·링크 요구는 항상 의심하세요.";
}

// ---------------------------------------------------------------------------
// 공개 함수: detectScam
// ---------------------------------------------------------------------------

/**
 * 문자·메시지 텍스트를 분석해 사기 위험도를 반환합니다.
 *
 * 채점 규칙 (V2):
 *   - 타입별 첫 번째 패턴 매치 1개만 신호로 등록합니다 (중복 가산 없음).
 *   - [V2] 매치된 신호에 highRiskPatterns 가 정의된 경우, 해당 패턴도 검사해
 *     고위험 패턴 매치 시 weight + highRiskBonus 로 가중치를 적용합니다.
 *
 * 콤보 보너스 (V2 확장):
 *   - url + money 동시 탐지: +10
 *   - impersonation + personalInfo 동시 탐지: +12
 *   - [V2] money + pressure 동시 탐지: +8  (송금 압박 패턴)
 *   - [V2] offPlatform + tooGood 동시 탐지: +12 (리딩방 패턴)
 *   - [V2] impersonation + pressure 동시 탐지: +8  (기관 협박 패턴)
 *
 * 임계값:
 *   >= 70 → 매우위험 / >= 45 → 위험 / >= 20 → 주의 / else → 안전
 */
export function detectScam(text: string): ScamResult {
  const signals: RiskSignal[] = [];

  // 규칙별로 패턴을 순회해 첫 매치 하나만 추출
  for (const rule of RULES) {
    let firstMatch: RegExpExecArray | null = null;

    for (const pattern of rule.patterns) {
      // g 플래그가 없어도 안전하게 lastIndex 초기화
      pattern.lastIndex = 0;
      const m = pattern.exec(text);
      if (m !== null) {
        firstMatch = m;
        break; // 타입 내 첫 패턴 매치면 충분
      }
    }

    if (firstMatch !== null) {
      // [V2] 고위험 하위 패턴 검사 — highRiskPatterns 중 하나라도 매치되면 보너스 적용
      let effectiveWeight = rule.weight;
      if (rule.highRiskPatterns && rule.highRiskBonus !== undefined) {
        for (const hrPattern of rule.highRiskPatterns) {
          hrPattern.lastIndex = 0;
          if (hrPattern.test(text)) {
            effectiveWeight = rule.weight + rule.highRiskBonus;
            break;
          }
        }
      }

      // [DAY10] 발췌에 PII 마스킹 적용 — 결과 화면에 사용자 전화/계좌가 원문 노출되지 않도록.
      // 분류 점수 산정은 마스킹 전 원본 text 기준으로 이미 완료된 상태임.
      signals.push({
        type: rule.type,
        label: rule.label,
        excerpt: maskPIIInternal(extractExcerpt(text, firstMatch.index, firstMatch[0].length)),
        why: rule.why,
        weight: effectiveWeight,
      });
    }
  }

  // 매치된 타입 집합
  const matchedTypes = new Set(signals.map((s) => s.type));

  // 기본 점수 합산
  let raw = signals.reduce((sum, s) => sum + s.weight, 0);

  // ── 콤보 보너스 (V1 유지) ──────────────────────────────────────────────
  if (matchedTypes.has("url") && matchedTypes.has("money")) {
    raw += 10; // 링크 + 금전 요구
  }
  if (matchedTypes.has("impersonation") && matchedTypes.has("personalInfo")) {
    raw += 12; // 기관 사칭 + 개인정보 요구
  }

  // ── 콤보 보너스 (V2 신규) ──────────────────────────────────────────────
  if (matchedTypes.has("money") && matchedTypes.has("pressure")) {
    raw += 8;  // 송금 + 압박 → 가족 사칭 등 전형적 패턴
  }
  if (matchedTypes.has("offPlatform") && matchedTypes.has("tooGood")) {
    raw += 12; // 플랫폼 이탈 + 비현실적 조건 → 리딩방 패턴
  }
  if (matchedTypes.has("impersonation") && matchedTypes.has("pressure")) {
    raw += 8;  // 기관 사칭 + 압박 → 공문·영장 협박 패턴
  }

  const riskScore = Math.min(100, raw);

  // 위험 등급 결정
  let level: RiskLevel;
  if (riskScore >= 70) {
    level = "매우위험";
  } else if (riskScore >= 45) {
    level = "위험";
  } else if (riskScore >= 20) {
    level = "주의";
  } else {
    level = "안전";
  }

  // weight 내림차순 정렬
  signals.sort((a, b) => b.weight - a.weight);

  const oneLineWarning = buildOneLineWarning(level, signals);
  const safeSummary = buildSafeSummary(signals);
  // DAY13: 분류 완료 후 등급만 참조해 행동 안내 생성 — 점수·등급에는 영향 없음
  const actionAdvice = buildActionAdvice(level);

  return { riskScore, level, signals, oneLineWarning, safeSummary, actionAdvice };
}
