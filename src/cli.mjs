#!/usr/bin/env node
/**
 * cli.mjs — AI 사기 메시지 방패 V2 CLI
 * DAY5: 빌드 없이 즉시 실행 가능한 순수 JS 버전.
 * scamDetector.ts 와 동일한 규칙·가중치·콤보·임계값을 사용합니다.
 *
 * DAY8~9 V2 개선:
 *   - 고위험 키워드 티어(highRiskPatterns / highRiskBonus): RAG식 KB 구조.
 *   - 콤보 보너스 확대: money+pressure(+8), offPlatform+tooGood(+12), impersonation+pressure(+8).
 *
 * DAY10 가드레일:
 *   - guardInput: 빈 입력 거부, 5000자 초과 자르기.
 *   - guardOutput: 단정 표현 완화 + 면책 문구 추가.
 *   - maskPII: 신호 발췌(excerpt)에서 전화번호·계좌번호 등 PII 마스킹.
 *   - detectPromptInjection: 프롬프트 인젝션 의심 입력 경고.
 *
 * 사용법:
 *   node src/cli.mjs "분석할 메시지"
 *   node src/cli.mjs          ← 인수 없으면 내장 예시 3개 자동 시연
 *   node src/cli.mjs --eval   ← DAY6~7 Harness 평가 실행 (evalRunner.mjs 호출)
 */

// ---------------------------------------------------------------------------
// DAY6~7: --eval 플래그 처리 (import 는 최상단에)
// ---------------------------------------------------------------------------

import { fileURLToPath } from "url";
import path from "path";
import { spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// DAY10: 가드레일 인라인 구현
// ---------------------------------------------------------------------------
// guardrails.mjs 를 import 하지 않고 인라인으로 둔다.
// (cli.mjs 는 standalone 원칙 유지, 외부 의존성 0)
// 규칙 변경 시 guardrails.mjs 와 함께 수정할 것.

/**
 * PII(개인식별정보) 마스킹 — 결과 발췌에 사용자 정보가 원문 노출되지 않도록.
 *   - 전화번호(01X-XXX(X)-XXXX): 가운데 국번 마스킹 → 010-****-5678
 *   - 카드번호(4-4-4-4): 두 번째 그룹부터 **** → 1234-****-****-****
 *   - 주민등록번호(6-7): 뒷 7자리 마스킹 → 801225-*******
 *   - 계좌번호(2~6-2~8-2~8): 가운데 그룹 마스킹
 * @param {string} text
 * @returns {string}
 */
function maskPII(text) {
  if (typeof text !== "string") return text;
  let result = text;

  // 카드번호: 4-4-4-4 형식 (가장 구체적 패턴 우선)
  result = result.replace(/\b(\d{4})-(\d{4})-(\d{4})-(\d{4})\b/g, "$1-****-****-****");

  // 주민등록번호: 6자리-7자리
  result = result.replace(/\b(\d{6})-(\d{7})\b/g, "$1-*******");

  // 전화번호: 01X-XXX(X)-XXXX
  result = result.replace(
    /\b(01\d)-(\d{3,4})-(\d{4})\b/g,
    (_match, p1, p2, p3) => `${p1}-${"*".repeat(p2.length)}-${p3}`
  );

  // 계좌번호: 숫자(2~6)-숫자(2~8)-숫자(2~8) (전화/카드/주민번호 처리 이후 남은 것)
  result = result.replace(
    /\b(\d{2,6})-(\d{2,8})-(\d{2,8})\b/g,
    (_match, p1, p2, p3) => {
      if (_match.includes("*")) return _match;
      return `${p1}-${"*".repeat(p2.length)}-${p3}`;
    }
  );

  return result;
}

/**
 * 입력 검사 — 분석 전처리.
 *   - 빈/공백만: ok: false, 거부 메시지
 *   - 5000자 초과: ok: true, 잘린 텍스트
 *   - 정상: ok: true, 원본
 * @param {string} text
 * @returns {{ ok: boolean, text: string, note: string|null }}
 */
function guardInput(text) {
  if (text === null || text === undefined) {
    return { ok: false, text: "", note: "입력이 비어 있습니다. 분석할 메시지를 입력해 주세요." };
  }
  const s = String(text);
  if (s.trim().length === 0) {
    return { ok: false, text: "", note: "입력이 비어 있습니다. 분석할 메시지를 입력해 주세요." };
  }
  const MAX = 5000;
  if (s.length > MAX) {
    return { ok: true, text: s.slice(0, MAX), note: `입력이 ${MAX}자를 초과해 앞 ${MAX}자만 분석합니다.` };
  }
  return { ok: true, text: s, note: null };
}

/**
 * 출력 검증 및 보강 — 분석 후처리.
 *   - 과도한 단정 표현 완화("100% 사기" 등)
 *   - 면책 고정 문구 항상 추가
 * @param {object} result
 * @returns {object}
 */
function guardOutput(result) {
  if (!result || typeof result !== "object") return result;

  const DISCLAIMER = "최종 판단은 사용자 몫이며, 의심되면 공식 기관에 직접 확인하세요.";

  const ASSERTIVE_PATTERNS = [
    /100\s*%\s*(사기|위험|확실)/,
    /확실(히|하게)\s*(사기|위험)/,
    /무조건\s*사기/,
    /반드시\s*사기/,
    /완전히?\s*사기/,
    /사기\s*(임이\s*)?확실/,
  ];

  let { oneLineWarning } = result;

  // 단정 표현 감지 및 완화
  const hasAssertive = ASSERTIVE_PATTERNS.some((p) => p.test(oneLineWarning));
  if (hasAssertive) {
    oneLineWarning = oneLineWarning
      .replace(/100\s*%\s*(사기|위험|확실)/g, "높은 가능성으로 사기 의심")
      .replace(/확실(히|하게)\s*(사기|위험)/g, "사기 의심")
      .replace(/무조건\s*사기/g, "사기 의심")
      .replace(/반드시\s*사기/g, "사기 의심")
      .replace(/완전히?\s*사기/g, "사기 의심")
      .replace(/사기\s*(임이\s*)?확실/g, "사기 의심");
  }

  // 면책 문구 추가 (중복 방지)
  if (!oneLineWarning.includes(DISCLAIMER)) {
    oneLineWarning = oneLineWarning + " " + DISCLAIMER;
  }

  return { ...result, oneLineWarning };
}

/**
 * 프롬프트 인젝션 의심 패턴 탐지.
 * V1 규칙 기반에는 직접 영향 없음. V2 LLM 도입 대비 + 입력단 방어 계층.
 * @param {string} text
 * @returns {{ injected: boolean, hits: string[] }}
 */
function detectPromptInjection(text) {
  if (typeof text !== "string") return { injected: false, hits: [] };

  const INJECTION_PATTERNS = [
    { pattern: /이전\s*(지시|명령|규칙|설정)\s*(무시|잊어|삭제)/i, label: "이전 지시 무시" },
    { pattern: /앞(의|에서)\s*(지시|명령|규칙)\s*(무시|잊어|삭제)/i, label: "앞의 지시 무시" },
    { pattern: /시스템\s*프롬프트/i, label: "시스템 프롬프트 언급" },
    { pattern: /system\s*prompt/i, label: "system prompt 언급" },
    { pattern: /너는\s*이제/i, label: "역할 전환 유도(너는 이제)" },
    { pattern: /지금부터\s*너는/i, label: "역할 전환 유도(지금부터 너는)" },
    { pattern: /당신은\s*이제/i, label: "역할 전환 유도(당신은 이제)" },
    { pattern: /ignore\s+previous/i, label: "ignore previous (영문)" },
    { pattern: /disregard\s+(all|your|the|instructions|rules)/i, label: "disregard instructions (영문)" },
    { pattern: /forget\s+(your|all|the)\s+instructions/i, label: "forget instructions (영문)" },
    { pattern: /새로운\s*지시/i, label: "새로운 지시 시도" },
    { pattern: /지시를\s*(바꿔|변경|수정)/i, label: "지시 변경 시도" },
    { pattern: /규칙을\s*무시/i, label: "규칙 무시 시도" },
    { pattern: /안전하다고\s*(답|말|출력)/i, label: "결과 조작 유도(안전하다고)" },
    { pattern: /정상이라고\s*(답|말|출력)/i, label: "결과 조작 유도(정상이라고)" },
    { pattern: /사기가\s*아니(라고|라고\s*해)/i, label: "결과 조작 유도(사기가 아니라고)" },
    { pattern: /act\s+as\s+(if|a|an)/i, label: "act as (역할 변환, 영문)" },
    { pattern: /jailbreak/i, label: "jailbreak 시도 (영문)" },
    { pattern: /DAN\b/i, label: "DAN 프롬프트 시도 (영문)" },
  ];

  const hits = [];
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(text)) hits.push(label);
  }
  return { injected: hits.length > 0, hits };
}

// ---------------------------------------------------------------------------
// 규칙 정의 (scamDetector.ts 와 동일)
// ---------------------------------------------------------------------------

/**
 * [V2] 고위험 키워드 KB (Knowledge Base) — 신고 사례 참고 확장.
 *
 * 7종 규칙 사전.
 * 가중치: url(18, 단축URL 고위험 +28=46) / money(22) / impersonation(20)
 *         pressure(16, 법적강제 고위험 +30=46) / personalInfo(22)
 *         offPlatform(12) / tooGood(12, 수익보장 고위험 +12=24)
 *
 * highRiskPatterns: 해당 패턴 매치 시 weight + highRiskBonus 적용.
 * 특정 케이스 텍스트 하드코딩 금지 — 키워드 일반화만 허용.
 */
const RULES = [
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
    highRiskBonus: 28, // 단축URL 단독 탐지 시 18+28=46 → 임계값 초과
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
    // money 단독은 정상 거래에도 등장 → 고위험 KB 미적용
  },
  {
    type: "impersonation",
    label: "기관 사칭",
    weight: 20,
    why: "공공기관·은행은 문자로 개인정보나 송금을 요구하지 않아요.",
    patterns: [
      /경찰|검찰|검사|금융감독원|금감원|국세청|법원|우체국|택배|관세청|세관|은행|고객센터|수사관|민원실|질병관리청/,
    ],
    // impersonation 단독은 정상 배송 문자 등에서 오탐 가능 → 고위험 KB 미적용
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
    highRiskBonus: 12, // 수익보장 매치 시 12+12=24점 (콤보와 결합해 임계값 초과 유도)
  },
];

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

/** 매치 인덱스 기준 앞뒤 ~30자를 잘라 반환합니다. */
function extractExcerpt(text, matchIndex, matchLength) {
  const PAD = 30;
  const start = Math.max(0, matchIndex - PAD);
  const end = Math.min(text.length, matchIndex + matchLength + PAD);
  const snippet = text.slice(start, end);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return prefix + snippet + suffix;
}

/** 등급과 최상위 신호를 조합해 비전공자용 경고문을 만듭니다. */
function buildOneLineWarning(level, signals) {
  if (level === "안전") {
    return "뚜렷한 사기 신호는 없지만, 모르는 사람의 송금·링크 요구는 항상 의심하세요.";
  }

  const topType = signals[0]?.type;

  const warningMap = {
    personalInfo: "인증번호·비밀번호를 묻는 전형적 사기예요. 절대 입력하지 마세요.",
    money: "입금·계좌이체를 요구하고 있어요. 돈을 보내기 전에 반드시 확인하세요.",
    impersonation: "공공기관·기업을 사칭하는 메시지예요. 직접 공식 번호로 확인하세요.",
    url: "의심스러운 링크가 있어요. 절대 클릭하지 말고 주소를 직접 확인하세요.",
    pressure: "'지금 당장'이라며 급하게 몰고 있어요. 서두르지 말고 주변에 물어보세요.",
    offPlatform: "안전결제 밖으로 유도하고 있어요. 플랫폼 내 결제만 이용하세요.",
    tooGood: "너무 좋은 조건은 사기의 미끼예요. 섣불리 응하지 마세요.",
  };

  const levelPrefix = {
    매우위험: "[매우위험] ",
    위험: "[위험] ",
    주의: "[주의] ",
  };

  const prefix = levelPrefix[level] ?? "";

  if (topType === undefined) {
    return prefix + "신중하게 판단하세요.";
  }

  return prefix + (warningMap[topType] ?? "신중하게 판단하세요.");
}

/** 탐지된 신호 개수와 라벨을 조합해 한 줄 요약을 만듭니다. */
function buildSafeSummary(signals) {
  if (signals.length === 0) {
    return "사기 신호가 발견되지 않았습니다.";
  }
  const labels = signals.map((s) => s.label).join("·");
  return `위험 신호 ${signals.length}개 발견: ${labels}`;
}

// ---------------------------------------------------------------------------
// 핵심 함수: detectScam (scamDetector.ts 와 동일 로직, V2)
// ---------------------------------------------------------------------------

/**
 * 문자·메시지 텍스트를 분석해 사기 위험도를 반환합니다.
 *
 * 채점 규칙 (V2):
 *   - 타입별 첫 번째 패턴 매치 1개만 신호로 등록합니다 (중복 가산 없음).
 *   - [V2] highRiskPatterns 매치 시 weight + highRiskBonus 적용.
 *
 * 콤보 보너스 (V2 확장):
 *   - url + money: +10
 *   - impersonation + personalInfo: +12
 *   - [V2] money + pressure: +8  (송금 압박)
 *   - [V2] offPlatform + tooGood: +12 (리딩방)
 *   - [V2] impersonation + pressure: +8  (기관 협박)
 *
 * 임계값: >= 70 → 매우위험 / >= 45 → 위험 / >= 20 → 주의 / else → 안전
 *
 * [DAY10] 신호 excerpt 에 PII 마스킹 적용 (분류 점수는 원본 기준 유지).
 *
 * @param {string} text
 * @returns {{ riskScore: number, level: string, signals: object[], oneLineWarning: string, safeSummary: string }}
 */
function detectScam(text) {
  const signals = [];

  for (const rule of RULES) {
    let firstMatch = null;

    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      const m = pattern.exec(text);
      if (m !== null) {
        firstMatch = m;
        break;
      }
    }

    if (firstMatch !== null) {
      // [V2] 고위험 하위 패턴 검사
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

      // [DAY10] 발췌에 PII 마스킹 적용 — 분류 점수 산정은 원본 text 기준으로 이미 완료
      signals.push({
        type: rule.type,
        label: rule.label,
        excerpt: maskPII(extractExcerpt(text, firstMatch.index, firstMatch[0].length)),
        why: rule.why,
        weight: effectiveWeight,
      });
    }
  }

  const matchedTypes = new Set(signals.map((s) => s.type));

  let raw = signals.reduce((sum, s) => sum + s.weight, 0);

  // ── 콤보 보너스 (V1 유지) ──────────────────────────────────────────────
  if (matchedTypes.has("url") && matchedTypes.has("money")) raw += 10;
  if (matchedTypes.has("impersonation") && matchedTypes.has("personalInfo")) raw += 12;

  // ── 콤보 보너스 (V2 신규) ──────────────────────────────────────────────
  if (matchedTypes.has("money") && matchedTypes.has("pressure")) raw += 8;   // 송금 압박
  if (matchedTypes.has("offPlatform") && matchedTypes.has("tooGood")) raw += 12; // 리딩방
  if (matchedTypes.has("impersonation") && matchedTypes.has("pressure")) raw += 8; // 기관 협박

  const riskScore = Math.min(100, raw);

  let level;
  if (riskScore >= 70) {
    level = "매우위험";
  } else if (riskScore >= 45) {
    level = "위험";
  } else if (riskScore >= 20) {
    level = "주의";
  } else {
    level = "안전";
  }

  signals.sort((a, b) => b.weight - a.weight);

  const oneLineWarning = buildOneLineWarning(level, signals);
  const safeSummary = buildSafeSummary(signals);

  return { riskScore, level, signals, oneLineWarning, safeSummary };
}

// ---------------------------------------------------------------------------
// 출력 헬퍼
// ---------------------------------------------------------------------------

const LEVEL_BAR = {
  안전: "[ 안전    ]",
  주의: "[ 주의    ]",
  위험: "[ 위험    ]",
  매우위험: "[ 매우위험 ]",
};

/** 분석 결과를 콘솔에 보기 좋게 출력합니다. */
function printResult(text, result) {
  const bar = "=".repeat(60);
  console.log(bar);
  console.log(`입력: "${text}"`);
  console.log(bar);
  console.log(`위험 점수  : ${result.riskScore} / 100`);
  console.log(`위험 등급  : ${LEVEL_BAR[result.level] ?? result.level}`);
  console.log(`경고       : ${result.oneLineWarning}`);
  console.log(`요약       : ${result.safeSummary}`);

  if (result.signals.length > 0) {
    console.log("\n탐지된 신호:");
    for (const sig of result.signals) {
      console.log(`  [${sig.type}] ${sig.label} (가중치: ${sig.weight})`);
      console.log(`    발췌: ${sig.excerpt}`);
      console.log(`    이유: ${sig.why}`);
    }
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// 내장 예시 (인수 없을 때 자동 시연)
// ---------------------------------------------------------------------------

const DEMO_CASES = [
  {
    label: "예시 1 — 명백한 스미싱",
    text: "[국세청] 미납 세금 확인 http://bit.ly/x 지금 본인인증",
  },
  {
    label: "예시 2 — 중고 선입금 사기",
    text: "아이폰15 급처! 시세보다 반값. 카톡으로 연락주세요. 선입금 후 발송합니다.",
  },
  {
    label: "예시 3 — 정상 문자",
    text: "내일 2시 강남역에서 직거래 가능할까요?",
  },
];

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

// process.argv: [node, cli.mjs, ...args]
const rawInput = process.argv[2];

if (rawInput === "--eval") {
  // --eval 플래그: evalRunner.mjs 를 호출해 Harness 평가 실행
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const evalRunnerPath = path.resolve(__dirname, "evalRunner.mjs");

  console.log("AI 사기 메시지 방패 V2 — Harness 평가 모드");
  console.log("evalRunner.mjs 를 실행합니다...\n");

  const evalResult = spawnSync(process.execPath, [evalRunnerPath], {
    stdio: "inherit",
    encoding: "utf-8",
  });

  if (evalResult.status !== 0) {
    console.error("evalRunner 실행 중 오류가 발생했습니다.");
    process.exit(evalResult.status ?? 1);
  }
} else if (rawInput === undefined) {
  // 인수 없으면 사용법 + 내장 예시 자동 시연 (빈 문자열은 아래 else 로 가서 guardInput 거부)
  console.log("AI 사기 메시지 방패 V2 — 규칙 기반 탐지 엔진 (DAY10 가드레일 적용)");
  console.log("사용법: node src/cli.mjs \"분석할 메시지\"");
  console.log("       node src/cli.mjs --eval   ← Harness 평가 실행\n");
  console.log("인수가 없어 내장 예시 3개를 자동 시연합니다.\n");

  for (const demo of DEMO_CASES) {
    console.log(`>>> ${demo.label}`);
    const rawResult = detectScam(demo.text);
    const result = guardOutput(rawResult);
    printResult(demo.text, result);
  }
} else {
  // [DAY10] 가드레일 파이프라인: 입력 검사 → 인젝션 탐지 → 분석 → 출력 검증

  // 1단계: 입력 검사 (guardInput)
  const inputGuard = guardInput(rawInput);
  if (!inputGuard.ok) {
    // 빈 입력 등 거부
    console.error(`[입력 오류] ${inputGuard.note}`);
    process.exit(1);
  }
  if (inputGuard.note) {
    // 길이 초과 알림
    console.warn(`[입력 알림] ${inputGuard.note}`);
  }

  const safeInput = inputGuard.text;

  // 2단계: 프롬프트 인젝션 탐지 (detectPromptInjection)
  const injectionCheck = detectPromptInjection(safeInput);
  if (injectionCheck.injected) {
    console.warn(`[보안 경고] 프롬프트 인젝션 의심 패턴이 탐지됐습니다: ${injectionCheck.hits.join(", ")}`);
    console.warn("           분석은 계속하지만, 결과를 신중하게 판단하세요.\n");
  }

  // 3단계: 분석 (detectScam — excerpt 에 PII 마스킹 포함)
  const rawResult = detectScam(safeInput);

  // 4단계: 출력 검증 (guardOutput — 단정 완화 + 면책 문구)
  const result = guardOutput(rawResult);

  printResult(safeInput, result);
}
