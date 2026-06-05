#!/usr/bin/env node
/**
 * guardrails.mjs — AI 사기 메시지 방패 DAY10 가드레일 모듈
 *
 * 순수 Node.js. 외부 의존성 0.
 * 입력 전처리(guardInput, detectPromptInjection) + 출력 후처리(guardOutput, maskPII) 계층.
 * 분류(detectScam) 로직 자체는 건드리지 않는다.
 *
 * 담당: 박서준(개발) — DAY10
 */

// ---------------------------------------------------------------------------
// 1. maskPII(text) — 개인식별정보(PII) 마스킹
// ---------------------------------------------------------------------------

/**
 * 텍스트 내 민감 개인정보를 마스킹해 결과 화면에 원문이 그대로 노출되지 않도록 한다.
 *
 * 처리 대상:
 *   - 전화번호: 010-1234-5678 형식 → 010-****-5678 (가운데 4자리 마스킹)
 *              01X-XXX-XXXX 3자리 국번 형태도 포함
 *   - 계좌번호: 숫자-숫자-숫자 (은행 계좌 일반 형식) → 앞 부분만 남기고 가운데 ***
 *   - 주민등록번호: 6자리-7자리 형식 → 앞 6자리-****** 마스킹
 *   - 카드번호: 4-4-4-4 형식 → 앞 4자리-****-****-**** 마스킹
 *
 * @param {string} text - 원본 텍스트
 * @returns {string} - PII가 마스킹된 텍스트
 */
export function maskPII(text) {
  if (typeof text !== "string") return text;

  let result = text;

  // 카드번호 먼저 처리 (4-4-4-4 형식, 가장 구체적인 패턴 우선)
  // 예: 1234-5678-9012-3456 → 1234-****-****-****
  result = result.replace(
    /\b(\d{4})-(\d{4})-(\d{4})-(\d{4})\b/g,
    "$1-****-****-****"
  );

  // 주민등록번호: 6자리-7자리
  // 예: 801225-1234567 → 801225-*******
  result = result.replace(
    /\b(\d{6})-(\d{7})\b/g,
    "$1-*******"
  );

  // 전화번호: 010-XXXX-XXXX 또는 01X-XXX-XXXX 형식
  // 예: 010-1234-5678 → 010-****-5678 (가운데 국번 마스킹)
  result = result.replace(
    /\b(01\d)-(\d{3,4})-(\d{4})\b/g,
    (match, p1, p2, p3) => {
      // 가운데 국번을 **** 로 치환, 마지막 4자리는 유지
      const maskedMiddle = "*".repeat(p2.length);
      return `${p1}-${maskedMiddle}-${p3}`;
    }
  );

  // 계좌번호: 숫자(2~6자리)-숫자(4~8자리)-숫자(2~8자리) 형식
  // 단, 이미 처리된 전화번호·카드번호·주민번호 패턴과 겹치지 않도록 나머지만 처리
  // 예: 110-123-456789 → 110-***-456789 (가운데 마스킹)
  result = result.replace(
    /\b(\d{2,6})-(\d{2,8})-(\d{2,8})\b/g,
    (match, p1, p2, p3) => {
      // 이미 마스킹된 * 포함 패턴은 건너뜀
      if (match.includes("*")) return match;
      const maskedMiddle = "*".repeat(p2.length);
      return `${p1}-${maskedMiddle}-${p3}`;
    }
  );

  return result;
}

// ---------------------------------------------------------------------------
// 2. guardInput(text) — 입력 검사
// ---------------------------------------------------------------------------

/** 입력 최대 허용 길이 (5000자 초과 시 잘라냄) */
const MAX_INPUT_LENGTH = 5000;

/**
 * 사용자 입력을 분석 전에 검사하고 정제한다.
 *
 * - 빈 문자열 또는 공백만인 입력: 거부 (ok: false)
 * - 5000자 초과: 잘라내고 note 에 알림 (ok: true, text: 잘린 텍스트)
 * - 정상 입력: ok: true, text: 원본
 *
 * @param {string} text - 사용자 입력 원문
 * @returns {{ ok: boolean, text: string, note: string|null }}
 */
export function guardInput(text) {
  // null/undefined 방어
  if (text === null || text === undefined) {
    return {
      ok: false,
      text: "",
      note: "입력이 비어 있습니다. 분석할 메시지를 입력해 주세요.",
    };
  }

  const strText = String(text);

  // 빈 입력 또는 공백만인 경우
  if (strText.trim().length === 0) {
    return {
      ok: false,
      text: "",
      note: "입력이 비어 있습니다. 분석할 메시지를 입력해 주세요.",
    };
  }

  // 길이 초과 시 잘라냄
  if (strText.length > MAX_INPUT_LENGTH) {
    const trimmed = strText.slice(0, MAX_INPUT_LENGTH);
    return {
      ok: true,
      text: trimmed,
      note: `입력이 ${MAX_INPUT_LENGTH}자를 초과해 앞 ${MAX_INPUT_LENGTH}자만 분석합니다.`,
    };
  }

  return { ok: true, text: strText, note: null };
}

// ---------------------------------------------------------------------------
// 3. guardOutput(result) — 출력 검증 및 보강
// ---------------------------------------------------------------------------

/**
 * 분석 결과에서 과도한 단정 표현을 완화하고, 면책 문구를 덧붙인다.
 *
 * 면책 고정 문구:
 *   "최종 판단은 사용자 몫이며, 의심되면 공식 기관에 직접 확인하세요."
 *
 * 단정 완화 대상 표현 (oneLineWarning 기준):
 *   "100% 사기", "확실히 사기", "무조건 사기", "반드시 사기" 등
 *   → "높은 가능성으로 사기 의심 메시지입니다" 형태로 완화
 *
 * @param {{ riskScore: number, level: string, signals: object[], oneLineWarning: string, safeSummary: string }} result
 * @returns {object} - 보강된 result (원본 객체를 변경하지 않고 새 객체 반환)
 */
export function guardOutput(result) {
  if (!result || typeof result !== "object") return result;

  /** 면책 고정 문구 */
  const DISCLAIMER =
    "최종 판단은 사용자 몫이며, 의심되면 공식 기관에 직접 확인하세요.";

  /** 단정 표현 패턴 (대소문자 무관, 한국어·영문 혼용) */
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
    // 단정 표현을 완화 문구로 교체
    oneLineWarning = oneLineWarning
      .replace(/100\s*%\s*(사기|위험|확실)/g, "높은 가능성으로 사기 의심")
      .replace(/확실(히|하게)\s*(사기|위험)/g, "사기 의심")
      .replace(/무조건\s*사기/g, "사기 의심")
      .replace(/반드시\s*사기/g, "사기 의심")
      .replace(/완전히?\s*사기/g, "사기 의심")
      .replace(/사기\s*(임이\s*)?확실/g, "사기 의심");
  }

  // 면책 문구 항상 추가 (이미 포함된 경우 중복 추가 안 함)
  if (!oneLineWarning.includes(DISCLAIMER)) {
    oneLineWarning = oneLineWarning + " " + DISCLAIMER;
  }

  return {
    ...result,
    oneLineWarning,
  };
}

// ---------------------------------------------------------------------------
// 4. detectPromptInjection(text) — 프롬프트 인젝션 탐지
// ---------------------------------------------------------------------------

/**
 * 입력 텍스트에서 프롬프트 인젝션 의심 패턴을 탐지한다.
 *
 * V1 규칙 기반 엔진에는 직접적 영향이 없으나,
 * V2 LLM 도입 대비 + 입력단 방어 계층으로 유지한다.
 *
 * 탐지 패턴:
 *   - 이전 지시 무시: "이전 지시 무시", "이전 명령 무시", "앞의 지시 무시" 등
 *   - 시스템 프롬프트 언급: "시스템 프롬프트", "system prompt" 등
 *   - 역할 전환 유도: "너는 이제", "지금부터 너는", "당신은 이제" 등
 *   - 영문 인젝션: "ignore previous", "disregard", "forget your instructions" 등
 *   - 탈출 시도: "```", 반복적 개행을 이용한 컨텍스트 오염 등
 *   - 지시 재설정: "새로운 지시", "지시를 바꿔", "규칙을 무시" 등
 *
 * @param {string} text - 검사할 입력 텍스트
 * @returns {{ injected: boolean, hits: string[] }}
 */
export function detectPromptInjection(text) {
  if (typeof text !== "string") return { injected: false, hits: [] };

  /** 인젝션 의심 패턴 목록 */
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
    if (pattern.test(text)) {
      hits.push(label);
    }
  }

  return {
    injected: hits.length > 0,
    hits,
  };
}
