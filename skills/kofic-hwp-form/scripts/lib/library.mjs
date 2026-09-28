// 양식함(템플릿 라이브러리) 저장소
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, libraryRoot } from './runtime.mjs';

export const CARD_SCHEMA = 'kofic-hwp-form/template@1';

export function templatesDir() {
  return ensureDir(join(libraryRoot(), 'templates'));
}
export function outputsDir() {
  return ensureDir(join(libraryRoot(), 'outputs'));
}
export function templateDir(id) {
  return join(templatesDir(), id);
}

export function slugify(name) {
  const s = String(name || '')
    .normalize('NFC')
    .trim()
    .replace(/\.(hwpx?|hwpml)$/i, '')
    .replace(/[\\/:*?"<>|#%&{}$!'`@+=^~,;[\]()]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return (s || 'template').slice(0, 60);
}

export function uniqueId(base) {
  let id = slugify(base);
  let n = 2;
  while (existsSync(templateDir(id))) id = `${slugify(base)}-${n++}`;
  return id;
}

export function listCards() {
  const dir = templatesDir();
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'template.json')))
    .map((d) => {
      try {
        return JSON.parse(readFileSync(join(dir, d.name, 'template.json'), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function loadCard(id) {
  const p = join(templateDir(id), 'template.json');
  if (!existsSync(p)) {
    const all = listCards().map((c) => c.id);
    const hint = all.length ? `등록된 양식: ${all.join(', ')}` : '등록된 양식이 없습니다. 먼저 `learn <파일>`로 양식을 학습하세요.';
    throw new Error(`양식 '${id}'를 찾을 수 없습니다. ${hint}`);
  }
  const card = JSON.parse(readFileSync(p, 'utf8'));
  card.dir = templateDir(id);
  return card;
}

export function saveCard(card) {
  const { dir, ...rest } = card;
  rest.updatedAt = new Date().toISOString();
  ensureDir(templateDir(rest.id));
  writeFileSync(join(templateDir(rest.id), 'template.json'), JSON.stringify(rest, null, 2) + '\n');
  return rest;
}

export function removeTemplate(id) {
  loadCard(id);
  rmSync(templateDir(id), { recursive: true, force: true });
}
