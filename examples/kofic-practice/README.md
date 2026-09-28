# 실습 안내: 영화진흥위원회 AX 실무: 한글 양식 학습·자동 작성

공개된 영화진흥위원회 문서로 “양식 학습 → 새 문서 완성 → 검수”를 직접 해 봅니다. 모든 값은 **가상 정보**입니다.

| 실습 | 시간 | 문서 | 배우는 것 |
| --- | --- | --- | --- |
| 0. 준비 | 5분 |: | 설치, 샘플 내려받기 |
| 1. 지난 공고 재활용 | 15분 | 입찰공고문(재공고).hwp | 바뀌는 칸만 교체, 공고번호 치환, **원본 날짜 오류 찾기** |
| 2. 신청서 채우기 | 15분 | (양식1) 첨단제작 지원 신청서.hwp | 빈칸·예시 표기·체크박스·표, 같은 라벨 구분, 검수 보고서 읽기 |
| 3. 표준 기안문 | 10분 | 내장 일반기안문(누름틀 23칸) | 누름틀 채우기, 공문 표기법 |
| 4. 내 양식 만들기 | 자유 | 내 업무 문서(공개 가능한 것) | 학습 결과 확인·수정, 동료와 공유 |

## 0. 준비

```bash
curl -fsSL https://raw.githubusercontent.com/reallygood83/kofic-form/main/install.sh | bash   # Windows는 install.ps1
git clone https://github.com/reallygood83/kofic-form && cd kofic-form                       # 실습 파일용
node examples/kofic-practice/fetch-samples.mjs                                               # 공개 문서 3개 내려받기
```

에이전트(Aside·Claude Code·Codex·Grok·Muse)를 쓰면 아래 “에이전트에게” 문장을 그대로 말하면 됩니다. 명령으로 해 보려면 `H`를 정해 두세요.

```bash
H="node $HOME/.agents/skills/kofic-hwp-form/scripts/hwpform.mjs"
S=examples/kofic-practice/samples
```

## 1. 지난 공고 재활용: 입찰공고문

**에이전트에게**: “`입찰공고문(재공고)_VP연구용역.hwp`를 ‘용역 입찰공고문’ 양식으로 학습해 줘. 원본에 이상한 점이 있으면 알려 줘.”

```bash
$H learn "$S/입찰공고문(재공고)_VP연구용역.hwp" --name "용역 입찰공고문" --org "영화진흥위원회" --id kofic-bid-notice
```

확인할 것
- 유형: 공고문, 추천 모드: reuse(기존 문서 재활용)
- 입력 칸: 공고명·사업금액·용역기간·계약방법·제출 시작/마감 일시·문의처 등
- **⚠ 원본 점검**: “2025. 8. 10. (월)”은 일요일 → 2026년이 맞는 것으로 보임(재공고 복사 흔적)

**에이전트에게**: “이 양식으로 ‘공공기관 업무 AI 전환(AX) 실무교육 운영 용역’ 입찰공고를 만들어 줘. 3천만 원(부가세 포함), 계약일부터 3개월, 접수 10월 5일 10시~10월 16일 14시, 과업 문의는 인사총무팀 051-720-0000, 공고번호는 입찰 2026-11-1호.”

```bash
$H fill kofic-bid-notice --values examples/kofic-practice/values-bid.json \
   --replace "입찰 2026-10-1호=>입찰 2026-11-1호" --out out/AX교육_입찰공고.hwp
```

기대 결과: HWP 그대로 3쪽, 값 6건 + 치환 1건, 지난 값 잔존 없음, 날짜·요일 이상 없음.
토론: 표기법 검수가 “AX(업무 AI 전환)”보다 “업무 AI 전환(AX)”을 권하는 이유는?

## 2. 신청서 채우기: (양식1) 공통서류

**에이전트에게**: “`(양식1)_첨단제작지원_공통서류.hwp`를 신청서 양식으로 학습하고, 채워야 할 칸을 섹션별로 정리해 줘.”

```bash
$H learn "$S/(양식1)_첨단제작지원_공통서류.hwp" --name "첨단제작 지원 신청서(양식1)" --org "영화진흥위원회" --id kofic-form1
$H values kofic-form1 --out out/form1-values.json
```

확인할 것
- “대표자 성명”이 신청인·공동제작사·국제공동제작사에 따로 있음 → `신청인 정보 > 대표자 성명`처럼 **섹션으로 구분된 키**
- 예시 표기 칸(`000-00-00000`, `YYYY년 MM월 DD일`, `@`)과 체크박스(`신청구분 (택1)`), 10행 투자 표

**에이전트에게**: “가상 제작사 ‘주식회사 한빛필름’으로 신청서를 채워 줘(값은 `values-form1.json` 참고). 모르는 칸은 비워 두고 알려 줘.”

```bash
$H fill kofic-form1 --values examples/kofic-practice/values-form1.json --out out/신청서_한빛필름.hwp
```

기대 결과: 17칸 반영, 누락 0. 일부 칸이 글상자 구조라 **자동 복구 경로**를 거쳐 HWPX로 저장되고 안내가 나옵니다(한글에서 HWP로 저장 가능). 보고서의 “미기입 칸”은 공동제작사 등 선택 항목입니다.
토론: 자동 검수가 잡아 주는 것과 사람이 꼭 봐야 하는 것은?

## 3. 표준 기안문: 누름틀

**에이전트에게**: “표준 일반기안문으로 ‘AX 실무교육 참석 협조 요청’ 공문을 써 줘. 수신자 참조, 교육은 10월 15일(목) 14:00~17:00 대회의실.”

```bash
$H builtin gian --org "영화진흥위원회"
$H fill gian --values examples/kofic-practice/values-gian.json --out out/협조요청.hwpx
```

기대 결과: 누름틀 15칸 채움, 본문 항목(1. 가.) 줄바꿈 유지, 표기법 문제 없음. `붙임` 값은 문서 이름만 둔다(`교육 운영계획`). 표준 기안문 서식이 뒤에 `1부. 끝.`을 붙이므로 값에 `1부.`를 넣지 않는다.
응용: `generate --md examples/kofic-practice/draft-notice.md --preset notice`로 모집 공고를 새로 생성해 보기.

## 4. 내 양식 만들기와 공유

1. 공개 가능한 내 업무 문서(예: 지난 결과 보고, 행사 계획서)를 학습시킨다.
2. `show <ID>`로 입력 칸 이름을 확인하고, 어색하면 에이전트에게 “칸 이름을 이렇게 바꿔 줘”라고 요청한다(`template.json`의 key 수정).
3. 새 건으로 문서를 완성하고 검수 보고서를 읽는다.
4. `pack <ID>`로 양식 꾸러미를 만들어 옆 사람에게 주고, 받은 사람은 `unpack`으로 등록해 바로 쓴다.

## 강사 메모

- 실습 전 `selftest.mjs`로 교육장 PC 환경을 점검하세요(17/17).
- 기관 PC에서 npm·GitHub가 막혀 있으면 [릴리스](https://github.com/reallygood83/kofic-form/releases/latest)의 `kofic-hwp-form-offline.zip`(필수 도구 포함)과 실습 샘플을 USB로 옮겨 설치하세요(README “오프라인 설치” 참고).
- 실제 업무 문서는 기관의 생성형 AI 이용 지침에 따르고, 개인정보가 있으면 `kordoc redact`로 가린 사본을 쓰세요.
