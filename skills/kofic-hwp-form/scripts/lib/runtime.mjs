// 런타임: 의존성 자동 설치, kordoc/rhwp 로딩, 경로, 출력 유틸
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SKILL_NAME = 'kofic-hwp-form';
export const SKILL_PKG = JSON.parse(readFileSync(join(SKILL_DIR, 'package.json'), 'utf8'));
const NODE_MODULES = join(SKILL_DIR, 'node_modules');

// kordoc 등 일부 의존성이 stdout에 경고를 찍으면 JSON 출력이 깨지므로 console.log는 stderr로 돌린다.
// 이 CLI의 결과는 반드시 out()/outJson()으로만 stdout에 쓴다.
console.log = (...args) => process.stderr.write(args.map(String).join(' ') + '\n');
console.info = console.log;

export function out(text = '') {
  process.stdout.write(String(text) + (String(text).endsWith('\n') ? '' : '\n'));
}
export function outJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}
export function note(text) {
  process.stderr.write(`[${SKILL_NAME}] ${text}\n`);
}

export function nodeMajor() {
  return Number(process.versions.node.split('.')[0]);
}

export function depsInstalled() {
  return (
    existsSync(join(NODE_MODULES, 'kordoc', 'package.json')) &&
    existsSync(join(NODE_MODULES, '@rhwp', 'core', 'package.json')) &&
    existsSync(join(NODE_MODULES, 'jszip', 'package.json'))
  );
}

// 필수 도구(kordoc, @rhwp/core) 설치. OCR·수식 모델 등 무거운 선택 의존성은 제외한다(--omit=optional).
export function installDeps({ force = false, quiet = false, dir = SKILL_DIR } = {}) {
  const already =
    existsSync(join(dir, 'node_modules', 'kordoc', 'package.json')) &&
    existsSync(join(dir, 'node_modules', '@rhwp', 'core', 'package.json')) &&
    existsSync(join(dir, 'node_modules', 'jszip', 'package.json'));
  if (!force && already) return { installed: false, dir };
  if (nodeMajor() < 20) {
    throw new Error(`Node.js 20 이상이 필요합니다 (현재 ${process.version}). https://nodejs.org 에서 LTS를 설치하세요.`);
  }
  const isWin = process.platform === 'win32';
  const args = ['install', '--omit=optional', '--no-audit', '--no-fund', '--loglevel=error'];
  if (!quiet) note(`필수 도구(kordoc, @rhwp/core) 설치 중… → ${dir}`);
  const r = spawnSync(isWin ? 'npm.cmd' : 'npm', args, {
    cwd: dir,
    stdio: ['ignore', quiet ? 'ignore' : 2, quiet ? 'ignore' : 2],
    shell: isWin,
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  if (r.error) throw new Error(`npm 실행 실패: ${r.error.message}. Node.js(npm 포함) 설치를 확인하세요.`);
  if (r.status !== 0) {
    throw new Error('npm install 실패: 네트워크(사내 프록시·방화벽)나 폴더 권한을 확인한 뒤 `node scripts/setup.mjs --force`를 다시 실행하세요.');
  }
  return { installed: true, dir };
}

let kordocModule = null;
export async function loadKordoc() {
  if (kordocModule) return kordocModule;
  if (!depsInstalled()) installDeps();
  kordocModule = await import('kordoc');
  return kordocModule;
}

let rhwpModule = null;
export async function loadRhwp() {
  if (rhwpModule) return rhwpModule;
  if (!depsInstalled()) installDeps();
  const mod = await import('@rhwp/core');
  if (typeof globalThis.measureTextWidth !== 'function') {
    // rhwp 조판 계산용 근사 폭 함수(브라우저 canvas 대체). 변환·필드 입력 결과에는 영향이 거의 없다.
    globalThis.measureTextWidth = (font, text) => {
      const m = /(\d+(?:\.\d+)?)px/.exec(String(font));
      const px = m ? parseFloat(m[1]) : 13.33;
      let w = 0;
      for (const ch of String(text)) {
        const c = ch.codePointAt(0);
        if (c === 32) w += px * 0.3;
        else if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xffdc)) w += px;
        else w += px * 0.55;
      }
      return w;
    };
  }
  const req = createRequire(join(SKILL_DIR, 'package.json'));
  let wasmPath;
  try {
    wasmPath = req.resolve('@rhwp/core/rhwp_bg.wasm');
  } catch {
    wasmPath = join(NODE_MODULES, '@rhwp', 'core', 'rhwp_bg.wasm');
  }
  await mod.default({ module_or_path: readFileSync(wasmPath) });
  rhwpModule = mod;
  return mod;
}

export function packageVersion(name) {
  try {
    const p = join(NODE_MODULES, ...name.split('/'), 'package.json');
    return JSON.parse(readFileSync(p, 'utf8')).version;
  } catch {
    return null;
  }
}

// 실제 사용자 홈. 일부 에이전트 샌드박스는 HOME을 바꾸므로 OS 계정 정보를 우선한다.
export function realHome() {
  try {
    const h = os.userInfo().homedir;
    if (h) return h;
  } catch {
    /* ignore */
  }
  return os.homedir();
}

export function libraryRoot() {
  const env = process.env.HWPFORM_HOME || process.env.KOFIC_HWP_FORM_HOME;
  return env ? resolve(env) : join(realHome(), 'Documents', 'hwp-form-library');
}

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

export function timestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
