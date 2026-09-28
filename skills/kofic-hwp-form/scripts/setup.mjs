#!/usr/bin/env node
// 설치 도우미: 필수 도구(kordoc, @rhwp/core) 설치 + 에이전트별 스킬 폴더 연결
//   node scripts/setup.mjs            의존성 설치 + 점검
//   node scripts/setup.mjs --link     + Claude Code / Codex / Grok / Muse Code / Aside 에 연결
//   옵션: --force(재설치·덮어쓰기) --only claude,grok,... --dry-run
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { SKILL_DIR, SKILL_NAME, installDeps, nodeMajor, realHome } from './lib/runtime.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};
const FORCE = has('--force');
const DRY = has('--dry-run');
const ONLY = (val('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const log = (s) => process.stdout.write(s + '\n');

function agentTargets(home) {
  const xdg = process.env.XDG_CONFIG_HOME || join(home, '.config');
  const codexHome = process.env.CODEX_HOME || join(home, '.codex');
  const t = [
    { agent: 'agents', label: '공용(~/.agents/skills: Codex·Grok·Muse Code 등)', dir: join(home, '.agents', 'skills'), when: () => true, kind: 'link' },
    { agent: 'claude', label: 'Claude Code', dir: join(home, '.claude', 'skills'), when: () => existsSync(join(home, '.claude')), kind: 'link' },
    { agent: 'codex', label: 'Codex', dir: join(codexHome, 'skills'), when: () => existsSync(codexHome), kind: 'link' },
    { agent: 'grok', label: 'Grok Build', dir: join(home, '.grok', 'skills'), when: () => existsSync(join(home, '.grok')), kind: 'link' },
    { agent: 'muse', label: 'Muse Code', dir: join(xdg, 'muse', 'skills'), when: () => existsSync(join(xdg, 'muse')), kind: 'link' },
  ];
  // Aside: ~/.aside/u/<계정>/skills/user — 심볼릭 링크 대신 실제 복사(+의존성 설치)
  const asideRoot = join(home, '.aside', 'u');
  if (existsSync(asideRoot)) {
    for (const acct of readdirSync(asideRoot)) {
      const d = join(asideRoot, acct, 'skills');
      if (existsSync(d)) t.push({ agent: 'aside', label: `Aside (계정 ${acct})`, dir: join(d, 'user'), when: () => true, kind: 'copy' });
    }
  }
  return t;
}

function samePath(a, b) {
  try {
    return resolve(a) === resolve(b);
  } catch {
    return false;
  }
}

function linkInto(target) {
  const dest = join(target.dir, SKILL_NAME);
  if (samePath(dest, SKILL_DIR)) return { status: 'self', dest };
  let exists = false;
  let isLink = false;
  try {
    const st = lstatSync(dest);
    exists = true;
    isLink = st.isSymbolicLink();
  } catch {
    /* none */
  }
  if (exists && isLink) {
    try {
      if (samePath(resolve(dirname(dest), readlinkSync(dest)), SKILL_DIR)) return { status: 'ok(이미 연결)', dest };
    } catch {
      /* ignore */
    }
  }
  if (exists && !FORCE && target.kind === 'link' && !isLink) return { status: '건너뜀(다른 폴더가 있음, --force로 교체)', dest };
  if (DRY) return { status: `dry-run(${target.kind})`, dest };
  mkdirSync(target.dir, { recursive: true });
  if (exists) rmSync(dest, { recursive: true, force: true });
  if (target.kind === 'copy') {
    cpSync(SKILL_DIR, dest, {
      recursive: true,
      dereference: true,
      filter: (src) => !/[\\/]node_modules([\\/]|$)/.test(src) && !/[\\/]\.git([\\/]|$)/.test(src),
    });
    const r = spawnSync(process.execPath, [join(dest, 'scripts', 'setup.mjs'), '--deps-only'], { stdio: 'inherit' });
    return { status: r.status === 0 ? 'ok(복사+설치)' : 'ok(복사) — 의존성은 첫 실행 때 자동 설치', dest };
  }
  symlinkSync(SKILL_DIR, dest, process.platform === 'win32' ? 'junction' : 'dir');
  return { status: 'ok(링크)', dest };
}

async function main() {
  if (nodeMajor() < 20) {
    log(`Node.js 20 이상이 필요합니다 (현재 ${process.version}). https://nodejs.org 에서 LTS 설치 후 다시 실행하세요.`);
    process.exit(1);
  }
  const r = installDeps({ force: FORCE });
  log(r.installed ? `✔ 필수 도구 설치 완료 (${SKILL_DIR})` : '✔ 필수 도구 이미 설치됨');
  if (has('--deps-only')) return;

  if (has('--link')) {
    const home = realHome();
    const results = [];
    for (const t of agentTargets(home)) {
      if (ONLY.length && !ONLY.includes(t.agent)) continue;
      if (!t.when()) {
        results.push({ label: t.label, status: '미설치(건너뜀)', dest: join(t.dir, SKILL_NAME) });
        continue;
      }
      try {
        results.push({ label: t.label, ...linkInto(t) });
      } catch (e) {
        results.push({ label: t.label, status: `실패: ${e.message}`, dest: join(t.dir, SKILL_NAME) });
      }
    }
    log('\n에이전트 연결 결과');
    for (const x of results) log(`- ${x.label}: ${x.status}  ${x.dest}`);
  }

  const d = spawnSync(process.execPath, [join(SKILL_DIR, 'scripts', 'hwpform.mjs'), 'doctor'], { stdio: 'inherit' });
  log('\n사용 예) 에이전트에게: "이 한글 파일을 양식으로 학습해줘" → "이 정보로 새 문서 만들어줘"');
  process.exit(d.status ?? 0);
}

main().catch((e) => {
  log(`설치 실패: ${e.message}`);
  process.exit(1);
});
