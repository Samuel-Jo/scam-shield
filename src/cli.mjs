#!/usr/bin/env node
/**
 * cli.mjs — AI 사기 메시지 방패 V1 CLI
 * DAY5: 빌드 없이 즉시 실행 가능한 순수 JS 버전.
 * scamDetector.ts 와 동일한 규칙·가중치·콤보·임계값을 사용합니다.
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
// 규칙 정의 (scamDetector.ts 와 동일)
// ---------------------------------------------------------------------------

/**
 * 7종 규칙 사전.
 * 가중치: url(18) / money(22) / impersonation(20) / pressure(16)
 *         personalInfo(22) / offPlatform(12) / tooGood(12)
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
// 핵심 함수: detectScam (scamDetector.ts 와 동일 로직)
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
      signals.push({
        type: rule.type,
        label: rule.label,
        excerpt: extractExcerpt(text, firstMatch.index, firstMatch[0].length),
        why: rule.why,
        weight: rule.weight,
      });
    }
  }

  const matchedTypes = new Set(signals.map((s) => s.type));

  let raw = signals.reduce((sum, s) => sum + s.weight, 0);

  if (matchedTypes.has("url") && matchedTypes.has("money")) {
    raw += 10;
  }
  if (matchedTypes.has("impersonation") && matchedTypes.has("personalInfo")) {
    raw += 12;
  }

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
const userInput = process.argv[2];

if (userInput === "--eval") {
  // --eval 플래그: evalRunner.mjs 를 호출해 Harness 평가 실행
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const evalRunnerPath = path.resolve(__dirname, "evalRunner.mjs");

  console.log("AI 사기 메시지 방패 V1 — Harness 평가 모드");
  console.log("evalRunner.mjs 를 실행합니다...\n");

  const evalResult = spawnSync(process.execPath, [evalRunnerPath], {
    stdio: "inherit",
    encoding: "utf-8",
  });

  if (evalResult.status !== 0) {
    console.error("evalRunner 실행 중 오류가 발생했습니다.");
    process.exit(evalResult.status ?? 1);
  }
} else if (userInput === undefined || userInput.trim() === "") {
  // 인수 없으면 사용법 + 내장 예시 자동 시연
  console.log("AI 사기 메시지 방패 V1 — 규칙 기반 탐지 엔진");
  console.log("사용법: node src/cli.mjs \"분석할 메시지\"");
  console.log("       node src/cli.mjs --eval   ← Harness 평가 실행\n");
  console.log("인수가 없어 내장 예시 3개를 자동 시연합니다.\n");

  for (const demo of DEMO_CASES) {
    console.log(`>>> ${demo.label}`);
    const result = detectScam(demo.text);
    printResult(demo.text, result);
  }
} else {
  // 인수가 있으면 해당 텍스트만 분석
  const result = detectScam(userInput.trim());
  printResult(userInput.trim(), result);
}
