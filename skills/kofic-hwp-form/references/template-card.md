# 양식 카드·값 파일·검수 보고서 구조

## 양식함 폴더

```
~/Documents/hwp-form-library/        (HWPFORM_HOME로 변경 가능)
├── templates/<ID>/
│   ├── template.json    양식 카드
│   ├── source.hwp|hwpx  학습한 원본 사본(수정하지 않음)
│   ├── source.md        원문 마크다운(에이전트 읽기·--edit-md 편집 기준)
│   ├── working.hwpx     HWP 원본의 HWPX 작업본(rhwp 변환, 복잡 셀 폴백용)
│   ├── profile.json     표 서식 프로필(있을 때, generate --profile)
│   └── sample-values.json  내장 서식 예시 값(있을 때)
└── outputs/             결과물 기본 위치 + <파일>.report.json
```

## template.json 주요 필드

| 필드 | 설명 |
| --- | --- |
| `id`, `name`, `org` | 양식 ID(폴더 이름), 표시 이름, 기관 |
| `docType` | `{type, label, preset, confidence, evidence}`: type: notice·official·report·plan·press·minutes·form·contract·other |
| `mode` | `fill`(빈칸 채우기) · `reuse`(지난 문서 재활용) · `fields`(누름틀) |
| `source` | 원본 파일명·형식(hwp/hwpx)·sha256·쪽수 |
| `working` | HWPX 작업본 정보(`contentLoss`: rhwp 변환 손실 보고 건수) |
| `fields[]` | 누름틀 `{name, placeholder, value}`: values에서 name을 key로 사용 |
| `slots[]` | 입력 칸(아래) |
| `entities[]` | 재활용 시 자주 바뀌는 값 후보(날짜·시간·금액·문서번호·전화·이메일) |
| `outline[]` | 제목 목록 |
| `sourceCheck` | 원본 점검(날짜·요일 불일치, 표기법 지적 수) |
| `style` | `{preset, profile}`: generate 기본 프리셋 |
| `notes` | 작성 요령 메모(사람이 자유롭게 기록) |

### slot 공통 필드

`key`(values에 쓰는 이름, 중복 없음) · `kind` · `label` · `section`(앞 제목) · `state`(`empty` 빈칸 / `placeholder` 예시 표기 / `filled` 내용 있음) · `type`(date·phone·email·amount·bizno·person·text…) · `sample`(원본 글자) · `hint` · `block`(IR 블록 번호)

| kind | 위치 정보 | values 입력 형식 |
| --- | --- | --- |
| `cell` | `r`,`c`,`labelCell` | 문자열(`\n`으로 줄바꿈) |
| `choice` | `cells[]`, `options[]`(`short`,`label`,`checked`), `multi` | 선택지 이름 문자열, 복수는 `"A, B"`, 단일 체크는 `true/false` |
| `table` | `headers[]`, `rows[]`(데이터 행 번호) | 2차원 배열 `[[행1칸1, 행1칸2, …], …]`, 유지할 칸은 `null` |
| `text` | 문단 안 `라벨: 값` | 문자열(원본 `sample` 부분만 교체) |

같은 라벨이 여러 번 나오면 key 앞에 섹션명이 붙는다(예: `신청인 정보 > 대표자 성명`, `공동제작사 정보 > 대표자 성명`).

## 값 파일(values.json)

```json
{
  "template": "kofic-form1",
  "values": {
    "신청사(제작사)명": "주식회사 ○○필름",
    "신청인 정보 > 대표자 성명": "홍길동",
    "신청구분 (택1)": "공동제작",
    "투자계약 체결 현황 정보": [[null, "( ■체결, □미체결)", "○○투자배급", "2,000,000,000", null]]
  },
  "_hints": { "…": "values 틀에만 있는 안내(무시됨)" }
}
```

- `_`로 시작하는 키와 `""` 값은 무시된다(칸 유지).
- 명령줄 보충: `--set 키=값`(여러 번), 배열·불리언은 JSON 문자열로 `--set '표=[[null,"값"]]'`.
- 문서 전체 치환: `--replace "옛글=>새글"`.

## 반영 방식(자동 3단계)

1. **직접 반영**: 원본을 kordoc IR로 읽고 slot 주소(표·행·열)의 글자만 바꾼 뒤 `patchHwp`/`patchHwpx`로 원본 파일 안에서 바뀐 칸만 교체한다(글꼴·표·쪽 설정 보존).
2. **HWPX 작업본 반영**: 1에서 반영되지 않은 값이 있으면(글상자·복잡 셀) rhwp로 만든 HWPX 작업본에 같은 편집을 적용한다.
3. **라벨 기반 채우기**: 그래도 남으면(병합 구조를 표 좌표로 재현할 수 없는 표) kordoc `fillHwpx`로 “라벨 옆 칸”에 채운다. 라벨이 문서에서 유일한 칸만 대상이며, 채워진 위치가 의도한 라벨이 아니면 되돌린다.
4. 누락이 가장 적은 결과를 채택한다. 누름틀은 HWPX는 kordoc `fillForm(hwpx-preserve)`, HWP는 rhwp `setFieldValueByName`.

출력 형식: 1단계로 끝나면 원본과 같은 형식. HWP 원본이 2·3단계를 거치면 HWPX로 저장한다(`--format hwp`로 강제하면 rhwp가 줄 배치를 재계산해 HWP로 변환).

## 검수 보고서(<결과>.report.json)

| 항목 | 의미 |
| --- | --- |
| `ok` | 누락·구조 오류·미적용 패치가 없으면 true(종료 코드 0), 아니면 false(종료 코드 2) |
| `checks.values` | 입력 값이 문서에 들어갔는지(`missing`) |
| `checks.stale` | 바꾼 칸의 지난 값이 문서 다른 곳에 남았는지 |
| `checks.unfilled` | 빈칸·예시 표기(000-0000, YYYY 등)·미선택 체크가 남은 칸 |
| `checks.weekday` | `2026. 8. 10.(월)` 같은 날짜와 요일이 실제 달력과 맞는지 |
| `checks.lint` | kordoc 공문서 표기법 검수(날짜·시간·금액·쌍점·물결표·외래어 등) |
| `checks.privacy` | 개인정보 종류별 개수(값은 기록하지 않음) |
| `checks.structure` | HWPX 구조 검증 / HWP 재파싱 |
| `checks.patch` | 서식 보존 패치 적용·미적용 내역 |
| `route` | `direct` 또는 `hwpx-fallback` |
