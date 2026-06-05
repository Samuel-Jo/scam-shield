/**
 * scamDetector.ts
 * AI 사기 메시지 방패 — V1 탐지 엔진 (standalone)
 *
 * DAY5: 규칙 기반 클라이언트 엔진. 외부 API·네트워크·시크릿 전혀 없음.
 * 같은 입력을 넣으면 항상 같은 출력이 나오는 결정론적(순수 함수) 모듈입니다.
 */

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
}

/**
 * 7종 규칙 사전 — 키워드·가중치는 팀 기획 단계에서 합의한 값입니다.
 * 탐지 로직은 타입별 첫 패턴 매치 1개만 사용합니다(중복 가산 없음).
 *
 * 가중치 요약:
 *   url(18) / money(22) / impersonation(20) / pressure(16)
 *   personalInfo(22) / offPlatform(12) / tooGood(12)
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
  },
  {
    type: "impersonation",
    label: "기관 사칭",
    weight: 20,
    why: "공공기관·은행은 문자로 개인정보나 송금을 요구하지 않아요.",
    patterns: [
      /경찰|검찰|검사|금융감독원|금감원|국세청|법원|우체국|택배|관세청|세관|은행|고객센터|수사관|민원실|질병관리청/,
    ],
  },
  {
    type: "pressure",
    label: "심리적 압박",
    weight: 16,
    why: "'지금 당장'으로 급하게 몰면 판단을 흐리려는 수법이에요.",
    patterns: [
      /지금|즉시|당장|마감|한정|계정\s?정지|벌금|체포|영장|미납|연체|긴급|마지막/,
    ],
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
// 공개 함수: detectScam
// ---------------------------------------------------------------------------

/**
 * 문자·메시지 텍스트를 분석해 사기 위험도를 반환합니다.
 *
 * 채점 규칙:
 *   - 타입별 첫 번째 패턴 매치 1개만 신호로 등록합니다 (중복 가산 없음).
 *   - url + money 동시 탐지 시 콤보 보너스 +10
 *   - impersonation + personalInfo 동시 탐지 시 콤보 보너스 +12
 *   - riskScore = Math.min(100, 합산점수 + 콤보보너스)
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
      signals.push({
        type: rule.type,
        label: rule.label,
        excerpt: extractExcerpt(text, firstMatch.index, firstMatch[0].length),
        why: rule.why,
        weight: rule.weight,
      });
    }
  }

  // 매치된 타입 집합
  const matchedTypes = new Set(signals.map((s) => s.type));

  // 기본 점수 합산
  let raw = signals.reduce((sum, s) => sum + s.weight, 0);

  // 콤보 보너스
  if (matchedTypes.has("url") && matchedTypes.has("money")) {
    raw += 10;
  }
  if (matchedTypes.has("impersonation") && matchedTypes.has("personalInfo")) {
    raw += 12;
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

  return { riskScore, level, signals, oneLineWarning, safeSummary };
}
