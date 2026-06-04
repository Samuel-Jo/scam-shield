# 📘 GitHub로 팀 프로젝트 시작하기 — 데모 팀 실전 따라하기

> 비전공 학생을 위한 교육자료입니다.
> **우리 데모 팀이 실제로 한 협업 과정**을 그대로 교재로 만들었습니다.
> 화면 속 예시가 아니라, 이 저장소에 실제로 남아 있는 커밋·PR을 보며 따라 할 수 있어요.
>
> 실제 저장소: <https://github.com/Samuel-Jo/scam-shield>

---

## 0. 한 장 요약 — 우리가 한 일

```
 PM(이도윤)              팀원(브랜치)                   통합(main)
 ──────────             ──────────────                ──────────
 ① 저장소 시작   ──▶    ③ 각자 feature 브랜치에서 작업
 ② 팀원과 공유          ④ PR(합쳐주세요 요청) 올림  ──▶  ⑤ 검토 후 병합(merge)
                                                        = main은 항상 안전
```

핵심 한 문장: **"`main`은 건드리지 않는다. 각자 브랜치에서 만들고, PR로 검토받아 합친다."**

---

## 1. 먼저, 5개 용어만 쉽게

| 용어 | 쉬운 뜻 | 비유 |
|------|---------|------|
| **저장소(Repository)** | 프로젝트의 코드·문서를 모아두는 온라인 창고 | 팀 공용 사물함 |
| **커밋(Commit)** | "저장 + 무엇을 바꿨는지 메모" | 사진을 찍어 날짜와 함께 보관 |
| **브랜치(Branch)** | main을 복사해 따로 작업하는 공간 | 시험지를 복사한 연습장 |
| **PR(Pull Request)** | "내 브랜치를 main에 합쳐 주세요" 요청 | 숙제 제출 + 검사 요청 |
| **병합(Merge)** | 검토 끝난 브랜치를 main에 합치는 것 | 합격한 연습 답안을 원본에 옮김 |

> 💡 우리는 모든 작업을 **GitHub Desktop(마우스 클릭)** 으로 할 수 있습니다.
> 아래에는 클릭 방법과, 참고용 명령어(CLI)를 함께 적었습니다.

---

## 2. STEP 1 — PM이 프로젝트(저장소)를 시작한다

팀장(PM) **이도윤**이 가장 먼저 저장소를 만들고, 팀의 약속(헌장)과 폴더 구조를 올렸습니다.

**GitHub Desktop으로:**
1. `File → New Repository…`
2. 이름 `scam-shield`, 로컬 폴더 지정, **README 체크**
3. `Create Repository` → `Publish repository`(온라인 업로드)

**참고 명령어(CLI):**
```bash
git init -b main
git add CHARTER.md docs/ .gitignore
git commit -m "docs: 프로젝트 시작 — 팀 헌장·폴더 구조(Docs as Code) 초안"
gh repo create scam-shield --public --source=. --push
```

👉 실제 첫 커밋: `91ded99` — *"docs: 프로젝트 시작 — 팀 헌장·폴더 구조"* (작성자: 이도윤)

> **왜 PM이 먼저?** 저장소의 기본 뼈대(헌장·폴더 규칙)가 있어야 팀원들이 같은 규칙으로
> 작업할 수 있기 때문입니다.

---

## 3. STEP 2 — 팀원과 공유한다

팀원이 같은 저장소에서 작업하려면 **접근 권한**이 필요합니다.

**방법 A — 협업자(Collaborator) 초대** (각자 GitHub 계정이 있을 때, 가장 일반적):
`저장소 → Settings → Collaborators → Add people` 로 팀원 GitHub 아이디 초대.
초대받은 팀원은 GitHub Desktop의 `Clone Repository`로 저장소를 자기 PC에 복제합니다.

**방법 B — 우리 데모 팀의 경우:**
이번 데모는 계정을 하나만 쓰므로, **하나의 저장소에서 브랜치로 나눠 협업**하고
커밋에 각자의 이름을 남겼습니다. (실제 팀은 보통 방법 A로 여러 명이 함께 들어옵니다.)

> 🔑 **황금 원칙:** 공유했다고 아무나 `main`에 바로 올리면 안 됩니다.
> 반드시 **브랜치 → PR → 병합** 순서를 지킵니다. (다음 단계)

---

## 4. STEP 3 — 각자 브랜치에서 작업한다

팀원은 `main`을 그대로 두고, **자기 브랜치**를 만들어 작업합니다.

**GitHub Desktop으로:** `Current Branch → New Branch → 이름 입력`
**참고 명령어:**
```bash
git checkout -b chore/scaffold-folders   # 브랜치 만들고 이동
# ...파일 작업...
git add src/README.md tests/README.md
git commit -m "chore: src/ tests/ 폴더 예약 (코드 DAY5·평가 DAY7부터)"
git push -u origin chore/scaffold-folders # 내 브랜치를 온라인에 올림
```

**브랜치 이름 규칙(우리 팀 헌장):** `feature/기능명`, `docs/문서명`, `chore/잡일`
**커밋 말머리 규칙:** `feat:`(기능) · `docs:`(문서) · `fix:`(수정) · `chore:`(설정/잡일)

---

## 5. STEP 4 — PR을 올리고 검토받는다

작업이 끝나면 **"내 브랜치를 main에 합쳐 주세요"** 라고 PR을 올립니다.

**GitHub Desktop으로:** 푸시 후 나타나는 `Create Pull Request` 클릭 → 제목·설명 작성.
**참고 명령어:**
```bash
gh pr create --title "chore: src/ tests/ 폴더 예약" --body "무엇을/왜..." --base main
```

PR에는 **무엇을·왜** 바꿨는지 적고, 팀원(보통 PM)이 검토합니다.

---

## 6. STEP 5 — main에 통합(merge)한다

검토에서 문제가 없으면 PR을 **병합(Merge)** 합니다. 그 순간 내 작업이 `main`에 안전하게 합쳐집니다.

**GitHub 웹/Desktop으로:** PR 화면의 `Merge pull request` 클릭.
**참고 명령어:**
```bash
gh pr merge 1 --merge --delete-branch   # 병합 후 다 쓴 브랜치 정리
git checkout main && git pull            # 내 PC의 main도 최신으로
```

---

## 7. 우리 팀이 실제로 한 협업 (DAY 0)

이 저장소에 **진짜로 남아 있는** 기록입니다. 직접 눌러서 확인해 보세요.

| 단계 | 누가 | 무엇을 | 결과 |
|------|------|--------|------|
| 저장소 시작 | 🧭 이도윤(PM) | 헌장·폴더 구조 첫 커밋 | `main` 생성 |
| [PR #1](https://github.com/Samuel-Jo/scam-shield/pull/1) `chore/scaffold-folders` | 🛠 박서준(개발) | `src/`·`tests/` 폴더 예약 | ✅ 병합됨 |
| [PR #2](https://github.com/Samuel-Jo/scam-shield/pull/2) `docs/day0-journey` | 🎨 정하린(UX) | DAY0 진행 일지 추가 | ✅ 병합됨 |

**실제 커밋 이력 (작성자가 팀원별로 남습니다):**
```
4d0b152  Merge pull request #2   ← 정하린 작업 통합
b9bfbd2  정하린:  docs: DAY0 진행 일지 작성
d72db9a  Merge pull request #1   ← 박서준 작업 통합
e5914b3  박서준:  chore: src/ tests/ 폴더 예약
91ded99  이도윤:  docs: 프로젝트 시작 — 팀 헌장·폴더 구조
```

> 이렇게 하면 **"누가, 언제, 무엇을, 왜"** 바꿨는지가 영원히 기록됩니다.
> 나중에 발표할 때 이 이력 자체가 훌륭한 '협업 증거'가 됩니다.

---

## 8. 자주 하는 실수 & 충돌(Conflict)

- ❌ `main`에서 바로 작업 → ✅ 항상 브랜치부터 만들기
- ❌ 커밋 메시지 "수정함" → ✅ `docs: 성공 기준 수치 오타 수정`처럼 말머리 + 무엇을
- **충돌(Conflict)**: 두 사람이 같은 줄을 고치면 발생. 당황하지 말고 GitHub Desktop의
  `Open in Visual Studio Code`로 열어, 초록(내 코드)/파랑(상대 코드) 중 선택 후
  저장 → `Continue merge`. (자세한 건 [GitHub Desktop 가이드] 참고)

---

## 9. 다음 단계

DAY1부터는 같은 흐름으로 **기획 문서**(problem_A.md 등)를 브랜치→PR→병합으로 쌓아갑니다.
개발 코드는 약속대로 **DAY5**부터 `src/`에 추가됩니다.

> 기억하세요: 협업의 핵심은 화려한 기술이 아니라 **"main을 지키는 약속"** 입니다. 🛡️
