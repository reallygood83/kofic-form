---
name: "kofic-hwp-form"
description: "한글(HWP/HWPX) 공문서 양식 학습·작성 스킬. 기존 .hwp/.hwpx 문서나 빈 양식을 넣으면 문서 유형(공고문·기안문·보고서·계획서·보도자료·회의록·신청서·계약서)과 입력 칸을 파악해 양식함에 템플릿으로 등록하고, 사용자가 준 기초 정보로 같은 기관 서식 그대로 새 HWP/HWPX 문서를 완성·검수한다(빈칸·체크박스·표·누름틀 채우기, 지난 문서 재활용, 공문서 표기법·날짜 요일·개인정보 점검). 공무원·공공기관(영화진흥위원회 등) 실무자의 한글 문서 작업, 양식 채우기, HWP↔HWPX 변환 요청에 사용. Korean HWP/HWPX form learning and filling for public-sector documents."
---

# 한글 양식 학습·문서 완성 (kofic-hwp-form)

기존 한글 문서를 **양식으로 학습**(유형·입력 칸·서식 파악)한 뒤, 사용자가 준 **기초 정보로 같은 서식의 새 문서**를 만들고 **검수**한다. 엔진은 kordoc(분석·서식 보존 반영·공문서 검수)과 rhwp(HWP↔HWPX 변환·누름틀)이며 모든 처리는 이 컴퓨터 안에서 한다.

실행: `node <이 SKILL.md가 있는 폴더>/scripts/hwpform.mjs <명령> [--json]`

- 첫 실행 때 필수 도구(kordoc, @rhwp/core, 약 60MB)를 스킬 폴더에 자동 설치한다. Node.js 20 이상 필요. 설치가 막히면 `node <스킬폴더>/scripts/setup.mjs`.
- 양식함: `~/Documents/hwp-form-library` (환경변수 `HWPFORM_HOME`로 변경). 결과물 기본 위치는 `양식함/outputs`.
- 에이전트는 `--json`을 붙여 결과를 읽는다. 종료 코드 0=정상, 1=오류(파일 안 만듦), 2=만들었지만 검수에서 확인 필요.

## 작업 순서

1. **점검**: `doctor`
2. **양식 학습**: `learn <파일.hwp|hwpx> --name "<문서 이름>" --org "<기관명>"`
   - 결과 카드: 문서 유형, 추천 모드(fill 빈칸 채우기 / reuse 기존 문서 재활용 / fields 누름틀), 입력 칸 key 목록, 원본 점검(⚠ 날짜·요일 오류 등).
   - 사용자에게 3~5줄로 알린다: 무슨 문서인지, 바뀌는 칸, 원본에서 발견한 문제.
   - 유형이 틀리면 `--type`(notice·official·report·plan·press·minutes·form·contract)으로 다시 학습. 칸 이름을 다듬고 싶으면 양식함의 `templates/<ID>/template.json`에서 `slots[].key`·`hint`만 고친다(key 중복 금지).
   - 한 번 학습한 양식은 계속 재사용한다. 먼저 `list`로 이미 있는지 확인.
3. **값 모으기**: `values <ID> --out <작업폴더>/values.json`
   - 사용자가 준 정보를 `values`에 넣는다. 모르는 사실(날짜·금액·성명·번호·연락처)은 지어내지 말고 `""`로 두고 한꺼번에 묻는다. `""`인 칸은 바뀌지 않는다.
   - 선택 칸: 선택지 이름(`"공동제작"`), 복수 선택은 `"A, B"`. 표: 2차원 배열, 그대로 둘 칸은 `null`(행 추가 불가).
   - 표기: 양식에 예시 표기(`YYYY년 MM월 DD일`, `000-0000-0000`)가 있으면 그 형식, 없으면 공문서 표기(`2026. 10. 15.(목)`, `14:00`, `30,000,000원`). 자세한 규칙은 `references/gongmun-style.md`.
4. **문서 완성**
   - fill·fields: `fill <ID> --values values.json --out <결과.hwp|hwpx>`
   - reuse: 바뀌는 칸은 values로, 문서 곳곳에 반복되는 문구(공고번호·연도 등)는 `--replace "옛글=>새글"`(여러 번 가능). 문단을 새로 써야 하면 `show <ID> --md`로 원문을 받아 복사본에서 필요한 문단만 고치고 `fill <ID> --edit-md 편집본.md`(표 구조·순서는 유지, 글자만 수정).
   - 구조가 다른 새 문서(같은 기관·같은 유형 스타일): 원고를 마크다운으로 쓰고 `generate --md 원고.md --preset <유형> [--template <ID>] [--approval 담당,팀장,과장]`. 유형별 원고 요령은 `references/doc-types.md`.
   - 출력 형식: 원본 HWP 안에서 바로 반영되면 HWP 그대로. 글상자·복잡한 표 때문에 복구 경로를 거치면 HWPX로 저장되고 안내가 나온다(한글에서 열어 HWP로 저장 가능). 형식을 정하려면 `--format hwp|hwpx`.
5. **검수**(fill·generate 뒤 자동): 값 누락, 지난 문서 값 잔존, 미기입 칸, 날짜·요일 불일치, 공문서 표기법, 개인정보, 파일 구조. 보고서는 `<결과파일>.report.json`.
   - 종료 코드 2면 보고서 항목을 고쳐 다시 실행한다.
   - "직접 반영에서 일부 칸 불가 → HWPX 작업본 반영 → 라벨 기반 채우기"는 자동 복구 경로다(글상자·병합이 복잡한 표 대응). 그래도 남는 칸은 보고서에 누락으로 나오니 사용자에게 알리고 한글에서 채우게 한다.
6. **전달**: 결과 파일 경로, 적용 항목 수, 검수 요약, 남은 미기입 칸을 알리고 "최종 확인은 한글에서 열어서"를 덧붙인다. 눈으로 확인할 때는 `preview <결과파일>`(쪽별 SVG + preview.html).

## 규칙

- 원본 양식 파일은 고치지 않는다. 결과는 항상 새 파일이다.
- 사실은 추측하지 않는다. 법령 서식의 고정 문구·조항은 바꾸지 않는다.
- 오류에 "정확한 키 중 선택"이 나오면 그 key로 values를 고쳐 다시 실행한다.
- 개인정보: 실습·시연은 가상 정보로 한다. 실제 민원·인사 문서는 기관의 생성형 AI 이용 지침을 먼저 확인한다.
- 표 행 추가, 그림·도장 삽입, 쪽 나눔 조정은 한글에서 마무리한다.

## 명령 요약

| 명령 | 용도 |
| --- | --- |
| `learn <파일>` / `builtin gian` | 양식 학습 / 표준 기안문(누름틀 23칸) 등록 |
| `list` · `show <ID> [--md]` | 양식 목록 · 양식 카드(입력 칸) 보기 |
| `values <ID> --out v.json` | 입력값 틀 만들기 |
| `fill <ID> --values v.json [--set 키=값] [--replace "옛=>새"] [--edit-md 편집본.md] --out 결과` | 문서 완성 + 검수 |
| `generate --md 원고.md --preset 유형` | 공문서 서식으로 새 문서 생성 |
| `verify <파일> [--template ID]` · `lint <파일>` | 검수만 · 표기법만 |
| `convert <파일> --to hwp\|hwpx` · `preview <파일>` | 형식 변환 · 미리보기 |
| `pack <ID>` / `unpack <zip>` | 동료와 양식 공유 |

## 에이전트별 메모

- **Aside**: 양식함은 실제 홈 기준으로 잡힌다. 결과 파일은 세션 artifacts 폴더에 복사해 보여 주고, 미리보기는 SVG를 탭에 넣어 스크린샷으로 확인한다.
- **Claude Code · Codex · Grok Build · Muse Code**: 위 명령을 셸에서 그대로 실행한다.
- **Grok Bot · Muse(클라우드 컴퓨터)**: 저장소의 `install.sh`로 설치한 뒤 같은 방법으로 쓴다. 사용자가 올린 파일은 작업 폴더(예: `/workspace`)에서 연다.

참고 자료: `references/template-card.md`(양식 카드·값 파일·보고서 구조), `references/doc-types.md`(유형별 바뀌는 칸과 작성 요령), `references/gongmun-style.md`(공문서 표기 핵심)
