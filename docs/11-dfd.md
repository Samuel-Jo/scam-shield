# 데이터 흐름도 (11-dfd.md)

> DAY 11 · AI 사기 메시지 방패 팀 · 담당: 정하린 (UX) · 문서 정리: 콘텐츠 라이터

---

## 흐름도 1 — 전체 파이프라인 (flowchart)

```mermaid
flowchart LR
    User([사용자 입력]) --> Pre[입력검사\nguardInput]
    Pre --> Inj{인젝션 탐지\ndetectPromptInjection}
    Inj -->|정상| Engine[규칙 엔진\ndetectScam]
    Inj -->|인젝션 감지| Engine
    Engine --> Post[출력검증\nguardOutput]
    Post --> Mask[PII 마스킹\nmaskPII]
    Mask --> Result([위험도 · 신호 · 경고])
    Engine -.참고.-> KB[(신고사례 키워드 KB\nhighRiskPatterns)]
```

> GitHub에서 이 파일을 열면 위 코드블록이 자동으로 그림으로 표시됩니다.

---

## 흐름도 2 — 메시지 교환 순서 (sequenceDiagram)

```mermaid
sequenceDiagram
    actor 사용자
    participant 웹 as 웹(CLI)
    participant 가드레일 as 가드레일<br/>(guardInput · detectPromptInjection)
    participant 엔진 as 규칙 엔진<br/>(detectScam)
    participant 출력검증 as 출력검증<br/>(guardOutput · maskPII)

    사용자->>웹: 메시지 텍스트 입력
    웹->>가드레일: 입력 전달 (guardInput)
    가드레일-->>웹: 빈 입력 · 5,000자 초과 시 즉시 거부
    가드레일->>가드레일: detectPromptInjection 실행
    가드레일->>엔진: 검사 통과 입력 전달 (인젝션 플래그 포함 가능)
    엔진->>엔진: 7종 신호 탐지 + 고위험 티어 + 콤보 보너스 계산
    Note over 엔진: highRiskPatterns KB 점선 참조
    엔진->>출력검증: 점수 · 신호 목록 전달
    출력검증->>출력검증: 단정 표현 완화 · 면책 문구 부착 (guardOutput)
    출력검증->>출력검증: 발췌 텍스트 PII 마스킹 (maskPII)
    출력검증->>웹: 최종 결과 전달
    웹->>사용자: 위험도 · 신호 · 경고 표시
```

---

## 흐름 설명

실제 파이프라인은 외부 LLM 호출이나 네트워크 요청이 **0건**입니다. 모든 단계가 로컬에서 실행됩니다.

**1단계 — 입력검사 (`guardInput`)**
사용자가 붙여넣은 메시지가 가장 먼저 `guardInput`을 거칩니다. 빈 문자열이거나 공백만 있으면 즉시 거부합니다. 5,000자를 초과하면 5,000자에서 잘라냅니다. 사기 문자는 대부분 짧으므로, 초과 입력은 정상 사용이 아닐 가능성이 높습니다.

**2단계 — 인젝션 탐지 (`detectPromptInjection`)**
"이전 지시를 무시해라", "ignore previous" 같은 패턴이 입력에 포함되어 있으면 경고 플래그를 붙입니다. 입력이 완전히 차단되지는 않지만, 탐지 사실이 결과에 함께 표시됩니다. V1 규칙 기반 엔진에서 인젝션의 직접 영향은 제한적이지만, V2 LLM 도입을 대비해 미리 구현해 두었습니다.

**3단계 — 규칙 엔진 (`detectScam`)**
우리 서비스의 핵심입니다. 7종 위험 신호(외부 링크 유도·개인정보 수집·긴급성 조성·금전 요구·기관 사칭·당첨 유도·비정상 발신 번호)를 탐지하고, 신호별 가중치로 0~100 점수를 계산합니다. 여기에 두 가지 추가 장치가 더해집니다. `highRiskPatterns` KB(신고 사례 키워드 모음)를 점선으로 참조해 고위험 키워드가 있으면 보너스 점수를 부여합니다. 위험 신호 두 가지가 동시에 감지되면 콤보 보너스도 추가됩니다. 45점 이상이면 사기 판정, 44점 이하면 정상 판정입니다.

**4단계 — 출력검증 (`guardOutput`)**
엔진이 계산한 결과를 사용자에게 보내기 전에 한 번 더 다듬습니다. "100% 사기"처럼 단정적인 표현은 "사기 가능성이 높습니다" 수준으로 완화합니다. 모든 결과 하단에는 고정 면책 문구("이 결과는 참고용입니다. 최종 판단은 사용자 본인이 하며, 확실하지 않을 경우 공식 기관에 확인하세요.")를 자동으로 붙입니다.

**5단계 — PII 마스킹 (`maskPII`)**
결과 발췌 텍스트에 포함된 전화번호·계좌번호·주민등록번호·카드번호 등 개인정보를 가운데 `***`로 치환합니다. 분류 점수는 원본 텍스트로 계산하고, 마스킹은 화면 표시 단계에만 적용합니다. 즉, 마스킹이 탐지 정확도에 영향을 주지 않습니다.

**6단계 — 결과 반환**
위험도 점수, 탐지된 신호 목록, 한 줄 경고 문장이 함께 표시됩니다. `docs/03-scenario.md`의 결정적 순간 정의("숫자와 이유가 함께 보여야 비로소 판단이 일어난다")를 구현한 단계입니다.

---

> 담당: 정하린 (UX) · DAY 11
> 관련 파일: `src/guardrails.mjs` / `src/scamDetector.mjs` / `docs/10-guardrails.md` / `docs/09-adr-0001.md`
