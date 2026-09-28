#!/usr/bin/env bash
# kofic-hwp-form 설치 — macOS · Linux · WSL · 클라우드 에이전트 컴퓨터(Grok Bot, Muse 등)
#
#   curl -fsSL https://raw.githubusercontent.com/reallygood83/kofic-form/main/install.sh | bash
#
#   옵션:  --only claude,grok,codex,muse,aside,agents   특정 에이전트에만 연결
#          --no-link                                    에이전트 연결 없이 설치만
#          --force                                      의존성 재설치·기존 폴더 교체
#   환경변수: KOFIC_FORM_DEST(설치 위치, 기본 ~/.agents/skills/kofic-hwp-form)
#            KOFIC_FORM_BRANCH(기본 main)  HWPFORM_HOME(양식함 위치)
set -euo pipefail

REPO="${KOFIC_FORM_REPO:-reallygood83/kofic-form}"
BRANCH="${KOFIC_FORM_BRANCH:-main}"
SKILL="kofic-hwp-form"
DEST="${KOFIC_FORM_DEST:-$HOME/.agents/skills/$SKILL}"
NODE_DIR="${KOFIC_FORM_NODE_DIR:-$HOME/.local/share/kofic-hwp-form/node}"

say() { printf '\033[1;34m[kofic-hwp-form]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[kofic-hwp-form] %s\033[0m\n' "$*" >&2; exit 1; }

LINK=1
PASS=()
for arg in "$@"; do
  case "$arg" in
    --no-link) LINK=0 ;;
    *) PASS+=("$arg") ;;
  esac
done

command -v curl >/dev/null 2>&1 || die "curl이 필요합니다."
command -v tar >/dev/null 2>&1 || die "tar가 필요합니다."

# 1) Node.js 20 이상 (없으면 개인 폴더에 설치 — 관리자 권한 불필요)
node_ok() { [ -n "${1:-}" ] && [ -x "$1" ] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)' >/dev/null 2>&1; }
NODE_BIN="$(command -v node || true)"
if ! node_ok "$NODE_BIN"; then
  if node_ok "$NODE_DIR/bin/node"; then
    NODE_BIN="$NODE_DIR/bin/node"
  else
    say "Node.js 20 이상이 없어 개인 폴더에 설치합니다: $NODE_DIR"
    case "$(uname -s)" in Darwin) P=darwin ;; Linux) P=linux ;; *) die "지원하지 않는 OS입니다. Windows는 install.ps1을 사용하세요." ;; esac
    case "$(uname -m)" in x86_64|amd64) A=x64 ;; arm64|aarch64) A=arm64 ;; *) die "지원하지 않는 CPU입니다: $(uname -m)" ;; esac
    BASE="https://nodejs.org/dist/latest-v22.x"
    FILE="$(curl -fsSL "$BASE/SHASUMS256.txt" | awk '{print $2}' | grep -E "^node-v[0-9.]+-$P-$A\.tar\.gz$" | head -1 || true)"
    [ -n "$FILE" ] || die "Node.js 배포 파일을 찾지 못했습니다. https://nodejs.org 에서 LTS를 설치한 뒤 다시 실행하세요."
    TMPN="$(mktemp -d)"
    curl -fsSL "$BASE/$FILE" -o "$TMPN/node.tgz"
    mkdir -p "$NODE_DIR"
    tar -xzf "$TMPN/node.tgz" -C "$NODE_DIR" --strip-components=1
    rm -rf "$TMPN"
    NODE_BIN="$NODE_DIR/bin/node"
    say "PATH에 추가하면 편합니다: export PATH=\"$NODE_DIR/bin:\$PATH\""
  fi
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
say "Node.js $("$NODE_BIN" -v)"

# 2) 스킬 파일 준비 (저장소 안에서 실행하면 그 파일을 그대로 사용)
SRC=""
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/skills/$SKILL/SKILL.md" ]; then
  SRC="$SCRIPT_DIR/skills/$SKILL"
else
  TMPD="$(mktemp -d)"
  trap 'rm -rf "$TMPD"' EXIT
  say "내려받는 중: github.com/$REPO ($BRANCH)"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$TMPD"
  SRC="$(find "$TMPD" -maxdepth 3 -type d -path "*/skills/$SKILL" | head -1)"
  [ -n "$SRC" ] || die "내려받은 저장소에서 skills/$SKILL 폴더를 찾지 못했습니다."
fi

# 3) 설치 위치로 복사 (이미 설치된 node_modules는 유지)
mkdir -p "$DEST"
SRC_REAL="$(cd "$SRC" && pwd -P)"
DEST_REAL="$(cd "$DEST" && pwd -P)"
if [ "$SRC_REAL" != "$DEST_REAL" ]; then
  find "$DEST" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  (cd "$SRC" && tar --exclude=node_modules --exclude=.DS_Store -cf - .) | (cd "$DEST" && tar -xf -)
fi
say "설치 위치: $DEST"

# 4) 필수 도구(kordoc·rhwp) 설치 + 에이전트 연결 + 점검
if [ "$LINK" = 1 ]; then
  "$NODE_BIN" "$DEST/scripts/setup.mjs" --link ${PASS[@]+"${PASS[@]}"}
else
  "$NODE_BIN" "$DEST/scripts/setup.mjs" ${PASS[@]+"${PASS[@]}"}
fi
say "완료! 에이전트에게 이렇게 말해 보세요: \"이 한글 파일을 양식으로 학습해줘\""
