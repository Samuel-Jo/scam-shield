# tests — 평가셋(Eval) 폴더

DAY6~7 Harness 강화 단계에서 구축한 자동 평가 체계입니다.

> 평가 원칙: "좋아졌다"는 느낌이 아니라 **Pass Rate 숫자**로만 판단한다.
> — 담당: 최유나(평가/데이터)

---

## 파일 구성

| 파일 | 설명 |
|------|------|
| `cases.json` | 16개 평가 케이스 (Basic 6 / Edge 5 / Safety 5) |

---

## 평가 케이스 설명 (16개)

### 태그 분류 기준

| 태그 | 케이스 수 | 의미 |
|------|-----------|------|
| Basic | 6개 | 명백한 사기 4건 + 명백한 정상 2건. V1 규칙 엔진이 확실히 맞춰야 하는 케이스. |
| Edge | 5개 | 규칙 V1이 틀릴 수 있는 경계 케이스. 단독 신호로 임계값 미달, 또는 정상 문자에 사기 키워드 포함. |
| Safety | 5개 | 실제 피해가 큰 고위험 사기 패턴. V1 미탐 케이스는 DAY8~9 개선의 핵심 근거. |

### 케이스 목록

| ID | Tag | expectedLabel | expectedSignals | 핵심 특징 |
|----|-----|---------------|-----------------|-----------|
| case-b01 | Basic | 사기 | url, impersonation, pressure, money | 금감원 사칭 + 링크 + 계좌 언급 + 압박. 콤보 +10. 86점. |
| case-b02 | Basic | 사기 | offPlatform, tooGood, money | 안전결제 회피 + 반값 미끼 + 선입금. 46점. |
| case-b03 | Basic | 사기 | impersonation, pressure, personalInfo | 고객센터 사칭 + OTP 요구 + 즉시 압박. 콤보 +12. 70점. |
| case-b04 | Basic | 사기 | tooGood, money, pressure | 원금보장 100% 고수익 + 입금 요구 + 지금. 50점. |
| case-b05 | Basic | 정상 | (없음) | 일상 점심 약속 문자. 사기 키워드 없음. 0점. |
| case-b06 | Basic | 정상 | (없음) | CJ대한통운 실제 배송 완료 문자. 링크·압박 없음. 20점(impersonation 탐지). |
| case-e01 | Edge | 사기 | pressure | "당장 연락 안 하면 영장" — pressure(16)만 탐지. 16점 < 45. **V1 미탐.** |
| case-e02 | Edge | 정상 | money | "계좌로 회비 보냈어?" — money(22) 탐지. 22점 < 45. 정상 판정 유지. |
| case-e03 | Edge | 사기 | url | "bit.ly/abc123" 단축URL만 — url(18)만 탐지. 18점 < 45. **V1 미탐.** |
| case-e04 | Edge | 정상 | money | 부동산 수수료 이체 요청 — money(22) 탐지. 22점 < 45. 정상 판정 유지. |
| case-e05 | Edge | 정상 | url | 건강보험공단 공식 URL — url(18) 탐지. 18점 < 45. 정상 판정 유지. |
| case-s01 | Safety | 사기 | impersonation, pressure, personalInfo, money | 수사관 사칭 + 주민번호·비밀번호 요구. 콤보 +12. 92점. |
| case-s02 | Safety | 사기 | offPlatform, tooGood | 카톡 리딩방 + 원금보장 100%. 24점 < 45. **V1 미탐.** |
| case-s03 | Safety | 사기 | pressure, money | 가족 사칭 + 당장 송금 + 계좌번호. 38점 < 45. **V1 미탐.** |
| case-s04 | Safety | 사기 | url, impersonation, pressure | 택배 미수령 + tinyurl 링크 + 지금. 54점. |
| case-s05 | Safety | 사기 | impersonation, personalInfo | 은행 사칭 + 보안카드·CVC 탈취. 콤보 +12. 54점. |

---

## 실행법

```bash
# 직접 실행 (권장)
node src/evalRunner.mjs

# cli.mjs --eval 옵션으로도 실행 가능
node src/cli.mjs --eval
```

---

## 실측 Pass Rate 결과 (DAY7 자동 평가, 2026-06-05)

| 구분 | 통과 / 전체 | Pass Rate |
|------|-------------|-----------|
| **전체** | **12 / 16** | **75.0%** |
| Basic | 6 / 6 | 100.0% |
| Edge | 3 / 5 | 60.0% |
| Safety | 3 / 5 | 60.0% |

### 실패 케이스 4건 상세

| ID | Tag | 실패 원인 | 점수 | 예측 | 기대 |
|----|-----|-----------|------|------|------|
| case-e01 | Edge | 라벨 불일치 — pressure 단독(16점) < 임계값 45. V1 규칙 엔진 미탐. | 16 | 정상 | 사기 |
| case-e03 | Edge | 라벨 불일치 — url 단독(18점) < 임계값 45. 단축 URL만 있을 때 V1 미탐. | 18 | 정상 | 사기 |
| case-s02 | Safety | 라벨 불일치 — offPlatform+tooGood(24점) < 임계값 45. 카톡 유도+원금보장 V1 미탐. | 24 | 정상 | 사기 |
| case-s03 | Safety | 라벨 불일치 — pressure+money(38점) < 임계값 45. 가족 사칭 송금 요청 V1 미탐. | 38 | 정상 | 사기 |

### 왜 100%가 아닌가

V1 규칙 엔진은 **단독 신호**의 위험 점수가 임계값(45점)에 미달할 경우 "정상"으로 판정합니다.
"당장 연락 안 하면 영장"(pressure 16점), 단축 URL 하나(url 18점), 리딩방 고수익 광고(offPlatform+tooGood 24점),
가족 사칭 송금 요청(pressure+money 38점)처럼 복합 키워드 없이 단독·소수 신호로만 구성된 사기 문자는 탐지하지 못합니다.

이는 규칙 기반 V1의 구조적 한계입니다. **DAY8 모델 보강·DAY9 RAG 도입**에서 이 4건을 근거 데이터로 활용해 개선합니다.

---

*최유나(평가/데이터) | DAY6~7 Harness 강화 단계 작성*
