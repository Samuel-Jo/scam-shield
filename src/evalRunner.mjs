#!/usr/bin/env node
/**
 * evalRunner.mjs — AI 사기 메시지 방패 V1 자동 평가 실행기
 *
 * DAY6~7: Harness(자동 평가 틀) — tests/cases.json 을 읽어
 * 각 케이스를 규칙 엔진으로 채점하고 Pass Rate 를 출력합니다.
 *
 * 의존성 0. 빌드 불필요.
 * 실행법: node src/evalRunner.mjs
 *
 * 판정 기준:
 *   predictedLabel = riskScore >= 45 ? "사기" : "정상"
 *   passLabel      = predictedLabel === expectedLabel
 *   passSignals    = expectedSignals 모두 탐지됨 (부분집합 조건)
 *   pass           = passLabel && passSignals
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// ---------------------------------------------------------------------------
// 규칙 정의 (cli.mjs / scamDetector.ts 와 동일 로직)
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
// 핵심 함수: detectScam (cli.mjs 와 동일 로직)
// ---------------------------------------------------------------------------

/**
 * 텍스트를 규칙 엔진으로 분석해 위험도를 반환합니다.
 * @param {string} text
 * @returns {{ riskScore: number, detectedTypes: Set<string> }}
 */
function detectScam(text) {
  const signals = [];

  for (const rule of RULES) {
    let firstMatch = null;

    for (const pattern of rule.patterns) {
      // g 플래그 없어도 안전하게 lastIndex 초기화
      pattern.lastIndex = 0;
      const m = pattern.exec(text);
      if (m !== null) {
        firstMatch = m;
        break; // 타입 내 첫 패턴 매치면 충분 (중복 가산 없음)
      }
    }

    if (firstMatch !== null) {
      signals.push({
        type: rule.type,
        weight: rule.weight,
      });
    }
  }

  const detectedTypes = new Set(signals.map((s) => s.type));

  // 기본 점수 합산
  let raw = signals.reduce((sum, s) => sum + s.weight, 0);

  // 콤보 보너스
  if (detectedTypes.has("url") && detectedTypes.has("money")) raw += 10;
  if (detectedTypes.has("impersonation") && detectedTypes.has("personalInfo")) raw += 12;

  const riskScore = Math.min(100, raw);

  return { riskScore, detectedTypes };
}

// ---------------------------------------------------------------------------
// 채점 함수: 케이스 1개를 판정하고 pass 여부 반환
// ---------------------------------------------------------------------------

/**
 * 케이스 1개를 채점합니다.
 *
 * @param {{ id, tag, text, expectedLabel, expectedSignals }} c - 케이스 객체
 * @returns {{ id, tag, riskScore, predictedLabel, expectedLabel, passLabel, passSignals, pass, missingSignals }}
 */
function scoreCase(c) {
  const { riskScore, detectedTypes } = detectScam(c.text);

  // 라벨 판정: 임계값 45 이상이면 "사기"
  const predictedLabel = riskScore >= 45 ? "사기" : "정상";
  const passLabel = predictedLabel === c.expectedLabel;

  // 신호 판정: expectedSignals 가 모두 탐지됐는지 (부분집합 조건)
  const missingSignals = c.expectedSignals.filter((s) => !detectedTypes.has(s));
  const passSignals = missingSignals.length === 0;

  // 최종 pass: 라벨과 신호 모두 통과해야 합격
  const pass = passLabel && passSignals;

  return {
    id: c.id,
    tag: c.tag,
    riskScore,
    predictedLabel,
    expectedLabel: c.expectedLabel,
    passLabel,
    passSignals,
    pass,
    missingSignals,
  };
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

// __dirname 대용 (ES Module 환경)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// cases.json 경로: src/ 의 부모 디렉터리 아래 tests/cases.json
const casesPath = path.resolve(__dirname, "..", "tests", "cases.json");

let cases;
try {
  const raw = readFileSync(casesPath, "utf-8");
  cases = JSON.parse(raw);
} catch (err) {
  console.error(`[evalRunner] cases.json 읽기 실패: ${casesPath}`);
  console.error(err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 전체 채점
// ---------------------------------------------------------------------------

const results = cases.map(scoreCase);

// ---------------------------------------------------------------------------
// 집계
// ---------------------------------------------------------------------------

const total = results.length;
const totalPass = results.filter((r) => r.pass).length;
const overallRate = ((totalPass / total) * 100).toFixed(1);

// 태그별 집계
const tags = ["Basic", "Edge", "Safety"];
const tagStats = {};
for (const tag of tags) {
  const group = results.filter((r) => r.tag === tag);
  const passCount = group.filter((r) => r.pass).length;
  tagStats[tag] = { pass: passCount, total: group.length };
}

// ---------------------------------------------------------------------------
// 출력: 케이스별 결과 표
// ---------------------------------------------------------------------------

const SEP = "=".repeat(80);
const SEP2 = "-".repeat(80);

console.log(SEP);
console.log("  AI 사기 메시지 방패 V1 — 자동 평가 결과 (evalRunner.mjs)");
console.log(SEP);
console.log("");

// 헤더
console.log(
  padR("ID", 12) +
    padR("Tag", 8) +
    padL("Score", 7) +
    "  " +
    padR("Pred", 6) +
    padR("Exp", 6) +
    padR("Label", 7) +
    padR("Signal", 8) +
    "PASS?"
);
console.log(SEP2);

for (const r of results) {
  const labelMark = r.passLabel ? "OK " : "FAIL";
  const signalMark = r.passSignals ? "OK " : "FAIL";
  const overallMark = r.pass ? "PASS" : "FAIL";

  const missing =
    r.missingSignals.length > 0 ? ` (missing: ${r.missingSignals.join(",")})` : "";

  console.log(
    padR(r.id, 12) +
      padR(r.tag, 8) +
      padL(String(r.riskScore), 7) +
      "  " +
      padR(r.predictedLabel, 6) +
      padR(r.expectedLabel, 6) +
      padR(labelMark, 7) +
      padR(signalMark, 8) +
      overallMark +
      missing
  );
}

console.log(SEP2);
console.log("");

// ---------------------------------------------------------------------------
// 출력: Pass Rate 요약
// ---------------------------------------------------------------------------

console.log("[ Pass Rate 요약 ]");
console.log("");
console.log(
  `  전체     : ${totalPass}/${total} 통과  →  Pass Rate ${overallRate}%`
);
console.log("");
for (const tag of tags) {
  const { pass, total: t } = tagStats[tag];
  const rate = ((pass / t) * 100).toFixed(1);
  console.log(
    `  ${padR(tag, 8)}: ${pass}/${t} 통과  →  ${rate}%`
  );
}
console.log("");

// ---------------------------------------------------------------------------
// 출력: 실패 케이스 상세
// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
if (failed.length === 0) {
  console.log("모든 케이스 통과! (Pass Rate 100%)");
} else {
  console.log(`[ 실패 케이스 ${failed.length}건 ]`);
  console.log("");
  for (const r of failed) {
    const reason = [];
    if (!r.passLabel) {
      reason.push(`라벨 불일치 (예측 "${r.predictedLabel}" / 기대 "${r.expectedLabel}", 점수 ${r.riskScore})`);
    }
    if (!r.passSignals) {
      reason.push(`신호 미탐지: ${r.missingSignals.join(", ")}`);
    }
    console.log(`  ${r.id} [${r.tag}]`);
    for (const rs of reason) {
      console.log(`    - ${rs}`);
    }
  }
}

console.log("");
console.log(SEP);
console.log(
  `  DAY6~7 Harness 평가 완료 | 규칙 V1 Pass Rate: ${overallRate}%`
);
console.log(
  "  미달 케이스는 DAY8 모델 개선·DAY9 RAG 도입의 근거 데이터입니다."
);
console.log(SEP);

// ---------------------------------------------------------------------------
// 유틸: 패딩 함수
// ---------------------------------------------------------------------------

/** 오른쪽 패딩 (왼쪽 정렬) */
function padR(str, len) {
  return String(str).padEnd(len, " ");
}

/** 왼쪽 패딩 (오른쪽 정렬, 숫자용) */
function padL(str, len) {
  return String(str).padStart(len, " ");
}
