# AGENTS.md: kofic-form 저장소 안내 (에이전트용)

이 저장소는 에이전트 스킬 **kofic-hwp-form**(한글 HWP/HWPX 양식 학습·문서 완성)을 담고 있다.

## 사용자가 “설치해줘”라고 하면

- macOS·Linux·WSL·클라우드 컴퓨터: `bash install.sh` (저장소 밖이면 `curl -fsSL https://raw.githubusercontent.com/reallygood83/kofic-form/main/install.sh | bash`)
- Windows PowerShell: `.\install.ps1` 또는 `irm https://raw.githubusercontent.com/reallygood83/kofic-form/main/install.ps1 | iex`
- 설치 결과: `~/.agents/skills/kofic-hwp-form`(실제 폴더) + Claude Code·Codex·Grok·Muse Code 스킬 폴더 링크 + Aside 계정 스킬 폴더 복사. 끝에 `doctor` 결과가 출력된다.
- 설치 권한이 없거나 스킬 폴더를 못 쓰는 환경이면: `node skills/kofic-hwp-form/scripts/setup.mjs` 후 이 저장소 경로에서 바로 사용한다.

## 사용자가 한글 문서 작업을 요청하면

`skills/kofic-hwp-form/SKILL.md`를 읽고 그 순서(doctor → learn → values → fill/generate → 검수 → 전달)를 따른다.

## 개발 규칙

- 코드: Node.js 20+ ESM, 외부 의존성은 kordoc·@rhwp/core·jszip만. 결과는 stdout(JSON 또는 사람용 요약), 진행 메시지는 stderr.
- 시험: `node skills/kofic-hwp-form/scripts/selftest.mjs` (15개 항목 모두 통과해야 함).
- 기획·명세: `docs/PRD.md`, `docs/SPEC.md`. 실습 자료: `examples/kofic-practice/`.
- 실제 기관 문서·개인정보는 저장소에 올리지 않는다(예제는 공개 문서를 실행 시 내려받는다).
