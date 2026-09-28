// 미리보기 보정: HWPX 문단 안의 강제 줄바꿈(hp:lineBreak)을 쪽 SVG에 나누어 그린다.
// kordoc 재조판은 lineBreak를 빈 칸으로 보고 한 줄에 이어 그린다. 조판 캐시(lineseg)가
// 줄 수보다 적으면, 그 문단만 줄바꿈마다 문단을 나누고 캐시를 빼서 재조판이 줄을 쌓게 한다.
// 캐시가 이미 줄마다 있으면 그대로 둔다(한컴이 저장한 좌표).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TAG_RE = /<(\/?)([A-Za-z0-9_]*:)?([A-Za-z0-9_]+)\b([^>]*?)(\/?)>/g;

function isLineBr(name, attrs) {
  if (name === 'lineBreak') return true;
  if (name !== 'br') return false;
  const type = /(?:^|\s)type="([^"]*)"/.exec(attrs)?.[1] || 'line';
  return type === 'line';
}

function scanParagraph(body) {
  TAG_RE.lastIndex = 0;
  let depth = 0;
  const breaks = [];
  let linesegs = 0;
  const arrays = [];
  let m;
  while ((m = TAG_RE.exec(body))) {
    const closing = m[1] === '/';
    const prefix = m[2] || '';
    const name = m[3];
    const attrs = m[4] || '';
    const self = m[5] === '/';
    if (name === 'p') {
      if (!self && !closing) depth += 1;
      else if (closing) depth -= 1;
      continue;
    }
    if (depth !== 1 || closing) continue;
    if (name === 'lineseg') linesegs += 1;
    else if (name === 'linesegarray') arrays.push(m.index);
    else if (isLineBr(name, attrs)) {
      let end = TAG_RE.lastIndex;
      if (!self) {
        const close = `</${prefix}${name}>`;
        const i = body.indexOf(close, end);
        if (i >= 0) end = i + close.length;
      }
      breaks.push({ start: m.index, end });
    }
  }
  return { breaks, linesegs, arrays };
}

function elementEnd(xml, openStart) {
  const m = /^<([A-Za-z0-9_]*:)?([A-Za-z0-9_]+)\b[^>]*?(\/?)>/.exec(xml.slice(openStart));
  if (!m) return openStart;
  const openEnd = openStart + m[0].length;
  if (m[3] === '/') return openEnd;
  const close = `</${m[1] || ''}${m[2]}>`;
  const i = xml.indexOf(close, openEnd);
  return i < 0 ? openEnd : i + close.length;
}

function paragraphSpan(xml, start) {
  const re = /<(\/?)([A-Za-z0-9_]*:)?p\b[^>]*?(\/?)>/g;
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(xml))) {
    if (m[3] === '/') continue;
    if (m[1] === '/') {
      depth -= 1;
      if (depth === 0) return { start, end: re.lastIndex };
    } else depth += 1;
  }
  return null;
}

function findEnclosing(xml, pos) {
  const re = /<(\/?)([A-Za-z0-9_]*:)?(p|run|t)\b([^>]*)>/g;
  const stack = [];
  const slice = xml.slice(0, pos);
  let m;
  while ((m = re.exec(slice))) {
    const closing = m[1] === '/';
    const selfClose = /\/\s*$/.test(m[4] || '');
    if (selfClose && !closing) continue;
    const name = m[3];
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          stack.splice(i);
          break;
        }
      }
    } else {
      stack.push({ name, prefix: m[2] || '', start: m.index, tag: m[0] });
    }
  }
  const t = [...stack].reverse().find((x) => x.name === 't');
  const run = [...stack].reverse().find((x) => x.name === 'run');
  const p = [...stack].reverse().find((x) => x.name === 'p');
  if (!t || !run || !p || !(p.start < run.start && run.start < t.start)) return null;
  return { p, run, t };
}

function removeLinesegArrays(body, arrays) {
  let out = body;
  for (const start of [...arrays].reverse()) {
    const end = elementEnd(out, start);
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

function splitDirectBreaks(body) {
  const { breaks } = scanParagraph(body);
  let out = body;
  for (const br of [...breaks].reverse()) {
    const enc = findEnclosing(out, br.start);
    if (!enc || enc.p.start !== 0) continue;
    const { p, run, t } = enc;
    const replacement = `</${t.prefix}t></${run.prefix}run></${p.prefix}p>${p.tag}${run.tag}${t.tag}`;
    out = out.slice(0, br.start) + replacement + out.slice(br.end);
  }
  return out;
}

export function rewriteParagraphBreaks(body) {
  const info = scanParagraph(body);
  if (!info.breaks.length || info.linesegs >= info.breaks.length + 1) return body;
  return splitDirectBreaks(removeLinesegArrays(body, info.arrays));
}

export function expandSectionLineBreaks(xml) {
  const starts = [];
  const re = /<([A-Za-z0-9_]*:)?p\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[3] === '/') continue;
    starts.push(m.index);
  }
  let out = xml;
  for (let i = starts.length - 1; i >= 0; i--) {
    const span = paragraphSpan(out, starts[i]);
    if (!span) continue;
    const body = out.slice(span.start, span.end);
    const next = rewriteParagraphBreaks(body);
    if (next !== body) out = out.slice(0, span.start) + next + out.slice(span.end);
  }
  return out;
}

export async function preparePreviewBytes(bytes) {
  const head = Buffer.from(bytes).subarray(0, 4).toString('hex');
  if (!head.startsWith('504b0304')) return bytes;
  try {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((n) => /section\d+\.xml$/i.test(n));
    let changed = false;
    for (const name of names) {
      const file = zip.file(name);
      if (!file) continue;
      const xml = await file.async('text');
      const next = expandSectionLineBreaks(xml);
      if (next !== xml) {
        zip.file(name, next);
        changed = true;
      }
    }
    if (!changed) return bytes;
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch {
    return bytes;
  }
}

const CHROME_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];
const CHROME_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

function chromeOnPath(name) {
  const r = spawnSync(name, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 });
  return r.status === 0;
}

export function findChrome(env = process.env) {
  const fromEnv = env.HWPFORM_CHROME || env.CHROME_PATH || env.CHROMIUM_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const p of CHROME_PATHS) if (existsSync(p)) return p;
  for (const name of CHROME_NAMES) if (chromeOnPath(name)) return name;
  if (process.platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const rels = ['Google\\Chrome\\Application\\chrome.exe', 'Chromium\\Application\\chrome.exe'];
    for (const root of roots) {
      for (const rel of rels) {
        const p = join(root, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

export function screenshotSvg(chrome, svgPath, pngPath) {
  const r = spawnSync(
    chrome,
    ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--window-size=800,1130', `--screenshot=${pngPath}`, pathToFileURL(svgPath).href],
    { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (r.error) throw new Error(r.error.message);
  if (r.status !== 0 || !existsSync(pngPath)) {
    const detail = `${r.stderr || ''} ${r.stdout || ''}`.trim().replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(detail || `exit ${r.status}`);
  }
}

export const PREVIEW_NOTE = '미리보기는 근사 조판입니다. 글자 간격·쪽 나눔은 한글에서 다시 확인하세요.';
export const PNG_SKIP_NOTE = 'PNG를 건너뛰었습니다. headless Chrome/Chromium을 찾지 못했습니다(google-chrome, chromium). SVG와 preview.html만 만들었습니다.';
