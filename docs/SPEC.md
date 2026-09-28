# SPEC: kofic-hwp-form v0.1 개발 명세

관련 문서: [PRD](./PRD.md) · 스킬 본문 [SKILL.md](../skills/kofic-hwp-form/SKILL.md) · 데이터 구조 [template-card.md](../skills/kofic-hwp-form/references/template-card.md)

## 1. 범위

에이전트가 호출하는 CLI(`hwpform`)와 스킬 문서(SKILL.md)로 구성된다. CLI는 HWP/HWPX 양식 학습, 입력값 반영, 새 문서 생성, 검수, 변환, 미리보기, 공유를 제공한다. 사용자와의 대화(정보 수집·확인)는 에이전트가 맡고, 문서 처리는 CLI가 결정적으로 수행한다.

## 2. 아키텍처

```
 사용자 ──대화──▶ 에이전트 (Aside · Claude Code · Codex · Grok Build/Bot · Muse Code/Muse)
                     │ SKILL.md: 작업 순서·규칙·명령
                     ▼
            hwpform CLI  (Node.js 20+ ESM · scripts/hwpform.mjs)
   ┌──────────────┬──────────────┬───────────────┬──────────────┐
 analyze.mjs    apply.mjs      verify.mjs      library.mjs     runtime.mjs
 칸 탐지·유형    IR 편집·키 해석  검수 7종         양식함 저장소    의존성·경로·출력
   └──────┬───────┴──────┬───────┴───────┬───────┘
      kordoc 4.15                 @rhwp/core 0.8 (WASM)
  parse·blocksToMarkdown·         HWP↔HWPX 변환·누름틀(HWP)·
  patchHwp/patchHwpx·fillHwpx·    reflowLinesegs·pageCount
  fillForm·markdownToHwpx·
  lint·redact·validate·render
                     ▼
   ~/Documents/hwp-form-library   templates/<ID>/ · outputs/
```

## 3. 저장소 구조

```
kofic-form/
├── skills/kofic-hwp-form/          ← 에이전트가 읽는 스킬(이 폴더만 설치됨)
│   ├── SKILL.md
│   ├── package.json                 의존성: kordoc, @rhwp/core, jszip
│   ├── scripts/
│   │   ├── hwpform.mjs              CLI 진입점(명령 17개)
│   │   ├── setup.mjs                의존성 설치 + 에이전트 연결 + 점검
│   │   ├── selftest.mjs             자체 시험 15항목
│   │   └── lib/{runtime,analyze,apply,verify,library}.mjs
│   └── references/{template-card,doc-types,gongmun-style}.md
├── install.sh / install.ps1         한 줄 설치(macOS·Linux·WSL / Windows)
├── .claude-plugin/                  Claude Code 플러그인·마켓플레이스 매니페스트
├── AGENTS.md                        저장소를 연 에이전트용 안내
├── docs/{PRD,SPEC}.md, docs/images/
└── examples/kofic-practice/         영화진흥위원회 공개 문서 실습 자료
```

## 4. 런타임과 설치

### 4.1 의존성 자동 설치

- `scripts/lib/runtime.mjs`의 `installDeps()`가 스킬 폴더에서 `npm install --omit=optional --no-audit --no-fund`를 실행한다.
  - kordoc의 선택 의존성(OCR·수식 모델·onnxruntime 등 약 600MB, 일부 AGPL)은 설치하지 않는다 → 설치 용량 약 57MB.
- 모든 명령은 처음 kordoc/rhwp를 불러올 때 의존성이 없으면 자동 설치한다(에이전트가 별도 설치 단계를 몰라도 동작).
- 진행 메시지는 stderr, 결과는 stdout. `console.log`를 stderr로 돌려 kordoc 경고가 JSON 출력을 오염시키지 않게 한다.

### 4.2 rhwp 초기화

`@rhwp/core`는 WASM이다. Node에서 `init({ module_or_path: <rhwp_bg.wasm 바이트> })`로 초기화하고, 브라우저 canvas 대신 근사 폭 함수 `globalThis.measureTextWidth(font, text)`(한글·CJK=글자 크기, 공백=0.3, 그 외=0.55)를 주입한다.

### 4.3 경로

| 용도 | 결정 규칙 |
| --- | --- |
| 스킬 폴더 | `scripts/lib/runtime.mjs` 기준 두 단계 위 |
| 양식함 | `HWPFORM_HOME` → 없으면 `os.userInfo().homedir/Documents/hwp-form-library`(샌드박스가 HOME을 바꿔도 실제 홈 사용) |
| 결과물 | `--out` → 없으면 `양식함/outputs/<시각>_<ID>.<형식>` |

### 4.4 설치 스크립트와 에이전트 연결

`install.sh` / `install.ps1` 공통 흐름:

1. Node.js 20+ 확인 → 없으면 nodejs.org `latest-v22.x`의 플랫폼 바이너리를 **개인 폴더**에 설치(`~/.local/share/kofic-hwp-form/node`, Windows `%LOCALAPPDATA%\kofic-hwp-form\node`).
2. 저장소 안에서 실행하면 로컬 파일, 아니면 `codeload.github.com` tarball/zip 내려받기.
3. `~/.agents/skills/kofic-hwp-form`에 복사(기존 `node_modules` 유지).
4. `node setup.mjs --link` 실행 → 의존성 설치 + 연결 + `doctor`.

`setup.mjs --link` 연결 대상(존재하는 에이전트만):

| 에이전트 | 위치 | 방식 |
| --- | --- | --- |
| 공용(Codex·Grok·Muse Code 등) | `~/.agents/skills/kofic-hwp-form` | 실제 폴더 |
| Claude Code | `~/.claude/skills/` | 심볼릭 링크(Windows는 junction) |
| Codex | `$CODEX_HOME/skills` 또는 `~/.codex/skills` | 링크 |
| Grok Build | `~/.grok/skills` | 링크 |
| Muse Code | `$XDG_CONFIG_HOME/muse/skills` (폴더가 있을 때) | 링크 |
| Aside | `~/.aside/u/<계정>/skills/user` | **복사** + 의존성 설치(심볼릭 링크 탐색 불확실성 회피) |

옵션: `--only claude,grok`, `--force`(재설치·교체), `--dry-run`, `--deps-only`. Aside 복사본에는 설치된 `node_modules`도 함께 복사한다(오프라인 PC 대응).

### 4.5 오프라인 설치 꾸러미

릴리스마다 `kofic-hwp-form-offline.zip`(스킬 폴더 + `node_modules`, `.bin` 제외)을 첨부한다. 의존성은 순수 JS·WASM(네이티브 `.node` 0개, os/cpu 제한 0개, 설치 스크립트 0개)이라 Windows·macOS·Linux 공용이다. `~/.agents/skills`에 풀고 `setup.mjs --link`를 실행하면 npm 없이 설치가 끝난다(의존성이 있으면 `installDeps`가 건너뜀). 최신 파일 주소: `https://github.com/reallygood83/kofic-form/releases/latest/download/kofic-hwp-form-offline.zip`.

추가 설치 경로: Claude Code 플러그인(`/plugin marketplace add reallygood83/kofic-form` → `/plugin install kofic-hwp-form@kofic-form`), `npx skills add reallygood83/kofic-form`, `muse skills install <폴더> --scope user`. 복사형 설치는 `node_modules`가 없으므로 첫 실행 때 자동 설치된다.

## 5. 데이터 모델

전체 필드 설명은 `references/template-card.md`. 요약:

```jsonc
// templates/<ID>/template.json
{
  "schema": "kofic-hwp-form/template@1",
  "id": "kofic-form1", "name": "…", "org": "영화진흥위원회",
  "docType": { "type": "form", "label": "신청서·서식", "preset": "report", "confidence": 0.82, "evidence": ["신청서", "…"] },
  "mode": "fill",                        // fill | reuse | fields
  "source": { "file": "source.hwp", "format": "hwp", "sha256": "…", "pages": 8 },
  "working": { "file": "working.hwpx", "from": "rhwp@0.8.6", "contentLoss": 0 },
  "fields": [ { "name": "제목", "placeholder": "제목을 입력하세요", "value": "" } ],
  "slots": [
    { "key": "신청인 정보 > 대표자 성명", "kind": "cell", "state": "empty", "type": "person",
      "block": 6, "r": 0, "c": 3, "labelCell": { "r": 0, "c": 2, "text": "대표자 성명" }, "hint": "…" },
    { "key": "신청구분 (택1)", "kind": "choice", "cells": [ … ], "multi": false,
      "options": [ { "short": "일반", "label": "일반(…)", "checked": false, "cell": 0, "nth": 0 } ] },
    { "key": "투자계약 체결 현황 정보", "kind": "table", "headers": [ … ], "rows": [1, 2, …], "sample": [[ … ]] }
  ],
  "entities": [ { "kind": "date", "value": "2026. 7. 28.", "count": 1 } ],
  "sourceCheck": { "weekday": [ { "date": "2025. 8. 10. (월)", "problem": "…일요일", "hint": "2026년이라면 월요일" } ], "lint": 4 },
  "style": { "preset": "report", "profile": "profile.json" },
  "tools": { "skill": "0.1.0", "kordoc": "4.15.7", "rhwp": "0.8.6" }
}
```

값 파일: `{ "values": { "<key>": "<값>" | ["A","B"] | true | [[…]] } }`. 검수 보고서: `<결과>.report.json`(`ok`, `route`, `checks.{values,stale,unfilled,weekday,lint,privacy,structure,patch}`).

## 6. 알고리즘

### 6.1 형식 판별

`kordoc.detectFormat` → 실패 시 매직 바이트(`D0CF11E0`=HWP 5.x OLE2, `PK`=HWPX ZIP) → 확장자. HWP/HWPX 외 형식은 학습 거부(PDF·DOCX는 원본 한글 파일 요청).

### 6.2 작업본

HWP 원본은 학습 시 rhwp `exportHwpxWithReport()`로 `working.hwpx`를 만든다. 용도: 누름틀 조회 보조, 표 서식 프로필(`hwpxToProfile`), 복구 경로 2·3단계. `contentLoss.count`를 카드에 기록한다.

### 6.3 입력 칸 탐지 (`analyze.detectSlots`)

1. **표 앵커화**: kordoc IR 표는 병합 셀을 “앵커 + 빈 자리 셀” 격자로 준다. `(r,c)`에서 colSpan×rowSpan 범위를 덮은 자리를 제외해 앵커 목록을 만든다.
2. **격자표 판별**: 첫 행 앵커가 3개 이상이고 모두 라벨형이면 `table` 슬롯(데이터 행 × 앵커 행렬).
3. **라벨-값 짝짓기**(행 단위, 왼→오):
   - 라벨형: 비어 있지 않음, 40자 이하·3줄 이하, 예시 표기 아님, 체크박스 없음, 숫자 비율 30% 이하, 문장형 아님.
   - 다음 칸이 체크박스면 이어지는 체크박스 칸을 묶어 `choice`.
   - 다음 칸이 빈칸·예시 표기이거나, 라벨이 `:`로 끝나거나, 다음 칸이 라벨형이 아니거나, 라벨이 기본 라벨 사전(성명·소속·연락처·사업명·기간·금액 …)에 있으면 `cell`.
   - 아니면 현재 라벨을 **상위 분류(prefix)**로 두고 다음 칸을 이어 본다(예: `총제작비 구성 > 순제작비(원)`).
4. **예시 표기(placeholder)**: 빈칸 / 서명(인) / 날짜(`YYYY년 MM월 DD일`, `년 월 일`) / 전자우편(`@`) / 숫자 틀(`000-00-00000`, `000,000,000`, 괄호 설명 제거 후 0·O·○·x가 2개 이상) / 성명 틀(`성명 / (남/여)`) / 안내 괄호(`(영문표기 병기)`) / 예시어(`OOO`, `○○○`).
5. **체크박스 파싱**: 박스 문자 `□■☐☑☒▢▣` 위치를 모두 찾고, 첫 박스 뒤 글자가 없고 앞 글자가 있으면 뒤 표기(`흑백 □`), 아니면 앞 표기(`□ 일반`)로 판단. 괄호 깊이를 추적하며 줄바꿈·`/`·`,`·`|`에서 선택지를 끊는다. 박스 하나당 선택지 하나(`cell`, `nth`로 위치 기록).
6. **안내문 제외**: 선택지 10개 초과, 평균 30자 초과, 35자 초과 선택지 존재, 박스 앞 설명 40자 초과, 단일 선택지가 “삽입·첨부·스캔”, 라벨이 “참고사항·작성요령·유의사항·안내”, 선택지 절반 이상이 지시문(“~작성”, “글꼴”) → 선택 칸 아님.
7. **문단 라벨**: 문단 줄이 `(기호) 라벨: 값` 형식이면 `text` 슬롯.
8. **키 부여**: 라벨이 문서에 두 번 이상이면 `섹션 > 라벨`. 섹션은 앞 제목(번호·□ 머리)에서 `[필수작성]`, `*…` 주석, 끝 괄호 설명을 뺀 이름. 앞 제목이 없으면 표 첫 라벨. 그래도 겹치면 `#2`.

### 6.4 유형 분류와 모드 추천

유형별 키워드 사전 점수(앞 4블록 ×3, 본문 최대 ×3) + 구조 가중(비어 있는 칸 3개 이상 → form, 누름틀 3개 이상 → official·form). 확신도 = (1위−2위+2)/(1위+2). 모드: 누름틀 ≥ 빈칸 → `fields`, form이거나 빈칸 ≥ max(3, 채워진 칸) → `fill`, 그 외 `reuse`.

### 6.5 값 적용 (`apply.applyValues`)

1. **키 해석** 순서: key 정확 → label 정확 → 공백 제거 비교 → key 끝부분 일치 → 원 라벨 비교 → 누름틀 이름. 모호하면 후보 목록과 함께 거부, 없으면 거부(파일 생성 안 함, 종료 코드 1).
2. **위치 확인**(`locate`): 저장된 라벨 셀 글자가 같은지 확인, 다르면 같은 라벨 셀을 문서 전체에서 찾아 상대 위치로 이동. 표 슬롯은 머리행 지문으로, 문단 슬롯은 원문 조각으로 재탐색.
3. **반영**: `cell` 글자 교체(중첩 표·그림이 든 칸은 거부) / `choice` 박스 재기입(■□ 또는 ☑☐ 스타일 유지) / `table` 행렬 교체(null 유지, 행 수 초과 거부) / `text` 문단 조각 교체(굵게 등 span 유지).
4. **전체 치환**: `--replace "옛=>새"`를 문단·목록·표 셀 전체에 적용하고 건수를 보고.

### 6.6 반영 경로(자동 3단계)와 출력 형식

```
IR 편집 → blocksToMarkdown
 ① patchHwp(원본.hwp) / patchHwpx(원본.hwpx) ─→ 누락 검사
 ② (HWP 원본, 누락 있음) working.hwpx에 같은 편집 → patchHwpx ─→ 누락 검사
 ③ (여전히 누락) kordoc fillHwpx: 라벨이 유일한 칸만, filled[].label이 의도한 라벨인지 확인,
    다른 곳에 채워졌거나 2곳 이상이면 해당 키 제외 후 재실행(최대 4회) ─→ 누락 검사
 → 누락이 가장 적은 결과 채택
```

- 누락 검사: 결과를 다시 읽어 입력 값(표는 각 칸, 체크박스는 재기입된 칸 글자)이 본문에 있는지 공백 무시 비교.
- 출력 형식: ①로 끝나면 원본 형식. HWP 원본이 ②·③을 거치면 **HWPX로 저장**하고 안내(한글에서 HWP로 저장 권장). `--format hwp`면 rhwp `reflowLinesegs()` 후 `exportHwpWithReport()`로 변환하고 확인 안내.
- 누름틀: HWPX는 kordoc `fillForm(…, 'hwpx-preserve')`, HWP는 rhwp `setFieldValueByName` → `exportHwpWithReport`.

### 6.7 새 문서 생성

`markdownToHwpx(md, { gongmun: { preset, approval?, …options } , profile? })`. 프리셋: official·report·plan·notice·minutes·press·gaejosik·ministry(kordoc). `--profile`은 양식 카드의 표 서식 프로필을 전달(같은 구조의 표에만 적용).

### 6.8 검수 규칙 (`verify.verifyDocument`)

| 검사 | 방법 | 실패 시 |
| --- | --- | --- |
| values | 입력 값이 결과 본문에 있는가 | ok=false |
| stale | 바꾼 칸의 지난 값(4자 이상, 예시 표기 제외)이 결과에 원본 이상 횟수로 남았는가 / `--replace` 옛글 잔존 | 경고 |
| unfilled | fill 모드에서 빈칸·예시 표기·미선택 체크 잔존(reuse는 예시 표기만) | 안내 |
| weekday | `YYYY. M. D.(요일)` 패턴의 실제 요일·존재하지 않는 날짜, 인접 연도 힌트 | 경고 |
| lint | kordoc `lintGongmunText`(기안문·공고문·보도자료는 문서 단위 규칙 포함) | 경고 |
| privacy | kordoc `redactText` 탐지 결과를 종류별 개수로만 기록 | 안내 |
| structure | HWPX `validateHwpx`, HWP 재파싱 성공 | ok=false |
| patch | 미적용 편집(복구되었으면 통과 표시) | ok=false(미복구 시) |

종료 코드: 0 정상, 1 오류(파일 없음), 2 파일 생성·확인 필요.

### 6.9 미리보기

kordoc `renderDocument(bytes, { format: 'svg', pages })` → `page-NN.svg` + `preview.html`(`<img>`로 SVG를 따로 불러 SVG 내부 id 충돌 방지).

## 7. CLI 명세

| 명령 | 주요 옵션 | 출력 |
| --- | --- | --- |
| `doctor` | | Node·kordoc·rhwp·양식함 점검 |
| `learn <파일>` | `--name --org --type --mode --id --force --notes` | 양식 카드 요약 / `--json` 카드 전체 |
| `builtin [gian\|gian-simple]` | `--org --id --force` | 내장 기안문 등록(예시 값 포함) |
| `list` · `show <ID>` | `--md`(원문 마크다운) | 목록·카드 |
| `values <ID>` | `--out` | 입력값 틀 JSON |
| `fill <ID>` | `--values --set 키=값 --replace "옛=>새" --edit-md --out --format same\|hwp\|hwpx --no-verify --no-fallback --force` | 결과 파일 + `.report.json` |
| `generate` | `--md --template --preset --approval --options --profile --out --format` | 생성 파일 + 보고서 |
| `verify <파일>` | `--template` | 검수 보고 |
| `convert <파일>` | `--to hwp\|hwpx --out` | 변환 파일(손실 보고) |
| `preview <파일>` | `--pages 1-3 --out-dir` | SVG + HTML |
| `lint <파일>` | `--document --munche` | 표기법·문체 지적 |
| `pack <ID>` · `unpack <zip>` | `--out` · `--id --force` | 양식 꾸러미 |
| `remove <ID>` · `where` | | |

공통: `--json`(기계용 단일 JSON), 오류 시 `{ "ok": false, "error": … }`.

## 8. 에이전트 통합

| 에이전트 | 설치 | 호출 |
| --- | --- | --- |
| Aside | `install.sh`가 `~/.aside/u/<계정>/skills/user`에 복사 | SKILL.md → bash로 CLI. 결과는 세션 artifacts로 복사, 미리보기는 탭 스크린샷 |
| Claude Code | 링크 또는 플러그인 마켓플레이스 | SKILL.md 자동 활성화 |
| Codex | `~/.agents/skills`·`~/.codex/skills` | 동일 |
| Grok Build | `~/.grok/skills`(또는 `~/.agents/skills`) | 동일, `/kofic-hwp-form` 슬래시 명령 |
| Grok Bot | 클라우드 컴퓨터에서 `install.sh` 실행 후 SKILL.md를 Private skill로 저장 | 작업 폴더(`/workspace`)의 파일 사용 |
| Muse Code | `~/.agents/skills` 자동 인식 또는 `muse skills install … --scope user` | 동일 |
| Muse(Meta AI 앱) | 기본 제공 스킬만 지원 → 클라우드 컴퓨터에서 `install.sh` 실행 + 작업 지시로 SKILL.md 절차 사용 | 파일 업로드 후 실행 |

클라우드 에이전트용 시작 문구(README에 수록): “이 컴퓨터에 `curl -fsSL https://raw.githubusercontent.com/reallygood83/kofic-form/main/install.sh | bash`를 실행하고, `~/.agents/skills/kofic-hwp-form/SKILL.md`를 읽은 뒤 그 절차대로 내가 올린 한글 파일을 양식으로 학습해 줘.”

## 9. 보안·개인정보

- CLI는 네트워크를 쓰지 않는다(설치 단계 제외). 문서·값·보고서는 사용자 컴퓨터에만 저장된다.
- 보고서에는 개인정보 **값**을 쓰지 않고 종류별 개수만 기록한다.
- 에이전트가 문서를 읽으면 그 내용은 해당 AI 모델로 전달된다 → 실습은 가상 정보, 실제 업무 문서는 기관 지침 확인. 필요하면 `kordoc redact`로 가린 사본 사용.
- 양식 꾸러미 풀기(unpack)는 템플릿 폴더 밖 경로(`..`, 하위 폴더)를 거부한다.

## 10. 시험

- **자체 시험** `node scripts/selftest.mjs`(임시 양식함 사용): HWPX 신청서 학습·채우기·체크박스, HWP 변환본 학습·채우기, 내장 기안문, 없는 키 거부, 날짜-요일 검사: 15항목.
- **실문서 회귀 세트**(`examples/kofic-practice/fetch-samples.mjs`로 내려받음): 입찰공고문(reuse, HWP 유지), 양식1(fill, 복구 ②), 양식2(fill, 복구 ③), 내장 기안문(fields).
- **수용 기준**: 자체 시험 15/15, 회귀 세트 누락 0, HWPX 구조 검증 통과, rhwp 변환 손실 0.

## 11. 알려진 한계

- 표 행 추가 불가(행 수 초과 입력 거부).
- 라벨이 여러 번 나오는 칸이 ①·②에서 모두 실패하면 ③에서도 채우지 않는다(보고서에 누락으로 표시).
- HWP 원본이 복구 경로를 거치면 기본 결과가 HWPX다.
- 쪽 수·쪽 넘김은 한글 실제 조판과 다를 수 있다(내용 보존은 검증됨).
- 글상자 안 긴 본문, 그림·도형·차트 편집은 범위 밖.
- 입력 칸 탐지는 규칙 기반이라 특이한 배치에서 이름이 어색할 수 있다 → 에이전트가 카드를 확인하고 key를 다듬는다.

## 12. 로드맵(기술)

1. 표 행 추가: kordoc 행 추가 패치(HWPX) 연계, HWP는 작업본 경유.
2. CSV 일괄 생성: `fill <ID> --batch 명단.csv --out-dir …`.
3. 도장 날인: `kordoc seal` 연계(`(인)` 앵커).
4. MCP 서버 모드: `hwpform mcp`(learn/fill/verify 도구).
