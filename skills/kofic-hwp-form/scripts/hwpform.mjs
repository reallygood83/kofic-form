#!/usr/bin/env node
// kofic-hwp-form CLI: 한글(HWP/HWPX) 양식 학습 → 값 입력 → 서식 보존 문서 완성 → 검수
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { classifyDocType, cleanLabel, detectSlots, docTypeInfo, findEntities, listDocTypes, normText, recommendMode, squash } from './lib/analyze.mjs';
import { applyValues, paragraphAppendsAttachmentUnit, plainText, replaceEverywhere } from './lib/apply.mjs';
import { CARD_SCHEMA, listCards, loadCard, outputsDir, removeTemplate, saveCard, slugify, templateDir, templatesDir, uniqueId } from './lib/library.mjs';
import { PNG_SKIP_NOTE, PREVIEW_NOTE, findChrome, preparePreviewBytes, screenshotSvg } from './lib/preview.mjs';
import { SKILL_DIR, SKILL_PKG, depsInstalled, ensureDir, libraryRoot, loadKordoc, loadRhwp, nodeMajor, note, out, outJson, packageVersion, timestamp } from './lib/runtime.mjs';
import { checkWeekdays, summarizeReport, verifyDocument } from './lib/verify.mjs';

const HELP = `kofic-hwp-form ${SKILL_PKG.version}: 한글(HWP/HWPX) 양식 학습·문서 완성

사용법: node scripts/hwpform.mjs <명령> [옵션]   (공통: --json 기계용 출력)

  doctor                               설치·환경 점검 (처음 실행 시 kordoc·rhwp 자동 설치)
  learn <파일.hwp|hwpx> [--name 이름] [--org 기관] [--type 유형] [--id ID] [--force]
                                       기존 문서/양식을 분석해 양식함에 템플릿으로 등록
  builtin [gian|gian-simple]           표준 기안문 서식(누름틀)을 양식함에 등록
  list                                 등록된 양식 목록
  show <ID> [--md]                     양식 카드(입력 칸·유형·모드) 보기, --md는 원문 마크다운
  values <ID> [--out 파일.json]        입력값 틀(JSON) 만들기
  fill <ID> [--values v.json] [--set 키=값 ...] [--replace "옛글=>새글" ...]
            [--edit-md 편집본.md] [--out 결과.hwp|hwpx] [--format same|hwp|hwpx] [--no-verify]
                                       값을 넣어 원본 서식 그대로 새 문서 완성 + 자동 검수
  generate --md 원고.md [--template ID] [--preset 유형] [--approval 담당,팀장,과장]
           [--options JSON] [--profile] [--out 결과.hwpx] [--format hwpx|hwp]
                                       원고(마크다운)를 공문서 서식 HWPX로 새로 생성
  verify <파일> [--template ID]        완성 문서 검수(미기입·표기법·개인정보·구조)
  convert <파일> --to hwpx|hwp [--out 파일]   HWP↔HWPX 변환 (rhwp)
  preview <파일> [--pages 1-3] [--out-dir 폴더] [--png]
                                       쪽별 SVG + preview.html (조판은 근사치). --png는 Chrome/Chromium이 있을 때만 쪽별 PNG
  lint <파일.md|txt|hwp|hwpx>          공문서 표기법 검수
  pack <ID> [--out 파일.zip] / unpack <파일.zip> [--id 새ID]   동료와 양식 공유
  remove <ID>                          양식 삭제
  where                                양식함·스킬 경로 표시

문서 유형(--type): ${listDocTypes().map((t) => `${t.type}(${t.label})`).join(', ')}
양식함 위치: 환경변수 HWPFORM_HOME (기본: ~/Documents/hwp-form-library)`;

function parseArgs(argv) {
  const args = { _: [], set: [], replace: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      let key;
      let val;
      const eq = a.indexOf('=');
      if (eq > 2) {
        key = a.slice(2, eq);
        val = a.slice(eq + 1);
      } else {
        key = a.slice(2);
        const nx = argv[i + 1];
        if (nx !== undefined && !(nx.startsWith('--') && nx.length > 2)) {
          val = nx;
          i += 1;
        } else val = true;
      }
      key = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (key === 'set' || key === 'replace') args[key].push(String(val));
      else args[key] = val;
    } else args._.push(a);
  }
  return args;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function detectFormat(k, bytes, path = '') {
  let fmt = null;
  try {
    fmt = k.detectFormat(bytes);
  } catch {
    /* ignore */
  }
  if (!fmt || fmt === 'unknown') {
    const head = bytes.subarray(0, 8).toString('hex');
    if (head.startsWith('d0cf11e0')) fmt = 'hwp';
    else if (head.startsWith('504b0304')) fmt = 'hwpx';
  }
  if (fmt === 'hwp5') fmt = 'hwp';
  if (!fmt && /\.hwpx$/i.test(path)) fmt = 'hwpx';
  if (!fmt && /\.hwp$/i.test(path)) fmt = 'hwp';
  return fmt;
}

async function convertBytes(bytes, to) {
  const r = await loadRhwp();
  const doc = new r.HwpDocument(new Uint8Array(bytes));
  try {
    if (to === 'hwp') {
      try {
        doc.reflowLinesegs();
      } catch {
        /* ignore */
      }
    }
    const ex = to === 'hwpx' ? doc.exportHwpxWithReport() : doc.exportHwpWithReport();
    let loss = null;
    try {
      loss = JSON.parse(ex.contentLoss());
    } catch {
      /* ignore */
    }
    const outBytes = Buffer.from(ex.takeBytes());
    ex.free?.();
    return { bytes: outBytes, loss };
  } finally {
    doc.free?.();
  }
}

async function rhwpFieldList(bytes) {
  const r = await loadRhwp();
  const doc = new r.HwpDocument(new Uint8Array(bytes));
  try {
    const raw = JSON.parse(doc.getFieldList() || '[]');
    const list = Array.isArray(raw) ? raw : raw.fields || [];
    return list
      .map((f) => (typeof f === 'string' ? { name: f } : { name: f.name ?? f.fieldName ?? f.command ?? '', placeholder: f.guide ?? f.guideText ?? f.placeholder ?? '', value: f.value ?? '' }))
      .filter((f) => f.name);
  } finally {
    doc.free?.();
  }
}

async function rhwpPageCount(bytes) {
  try {
    const r = await loadRhwp();
    const doc = new r.HwpDocument(new Uint8Array(bytes));
    try {
      return doc.pageCount();
    } finally {
      doc.free?.();
    }
  } catch {
    return null;
  }
}

async function rhwpSetFields(bytes, values) {
  const r = await loadRhwp();
  const doc = new r.HwpDocument(new Uint8Array(bytes));
  const results = [];
  try {
    for (const [name, value] of Object.entries(values)) {
      let res;
      try {
        res = doc.setFieldValueByName(name, String(value));
      } catch (e) {
        res = e.message;
      }
      results.push({ name, result: String(res).slice(0, 120) });
    }
    const ex = doc.exportHwpWithReport();
    const outBytes = Buffer.from(ex.takeBytes());
    ex.free?.();
    return { bytes: outBytes, results };
  } finally {
    doc.free?.();
  }
}

function slotHint(s) {
  const hints = [];
  if (s.kind === 'choice') hints.push(`${s.multi ? '복수 선택 가능' : '하나만 선택'}: ${s.options.map((o) => o.short).join(' | ')}`);
  if (s.kind === 'table') hints.push(`표 ${s.rows.length}행 × 칸 배열 [[…],[…]] (null=유지, 행 추가는 한글에서) · 열: ${s.headers.join(' / ')}`);
  if (s.placeholder && s.placeholder !== 'empty') hints.push(`양식 표기: ${normText(s.sample).slice(0, 40)}`);
  const byType = {
    date: '날짜 예: 2026. 10. 15.(목): 양식 표기가 있으면 그 형식',
    phone: '전화 예: 051-720-0000',
    email: '전자우편 예: name@example.go.kr',
    amount: '금액 예: 30,000,000 (필요 시 “금30,000,000원(금삼천만원)”)',
    bizno: '사업자등록번호 000-00-00000',
    rrn: '주민등록번호: 실습에는 가상 값 사용',
    person: '성명(필요 시 직위 포함)',
  };
  if (byType[s.type]) hints.push(byType[s.type]);
  if (s.kind === 'text') hints.push('문단 안의 “라벨: 값” 부분');
  return hints.join(' · ');
}

function slotForCard(s) {
  const base = {
    key: s.key,
    kind: s.kind,
    label: s.label,
    section: s.section || '',
    state: s.state,
    type: s.type,
    sample: s.sample,
    block: s.block,
  };
  if (s.placeholder) base.placeholder = s.placeholder;
  if (s.kind === 'cell' || s.kind === 'choice') Object.assign(base, { r: s.r, c: s.c, labelRaw: s.labelRaw, labelCell: s.labelCell });
  if (s.kind === 'choice') Object.assign(base, { cells: s.cells, options: s.options, multi: s.multi });
  if (s.kind === 'table') Object.assign(base, { headers: s.headers, rows: s.rows });
  base.hint = slotHint(s);
  return base;
}

async function learnFromBytes(bytes, opts) {
  const k = await loadKordoc();
  const fmt = detectFormat(k, bytes, opts.originalName || '');
  if (!['hwp', 'hwpx'].includes(fmt)) {
    throw new Error(`한글 파일(HWP/HWPX)만 양식으로 학습할 수 있습니다(감지된 형식: ${fmt || '알 수 없음'}). PDF·DOCX만 있다면 원본 한글 파일을 받아 주세요.`);
  }
  const parsed = await k.parse(bytes);
  if (!parsed.success) throw new Error(`문서를 읽지 못했습니다: ${parsed.error}${parsed.code === 'ENCRYPTED' ? ' (암호 문서는 암호를 풀어 다시 저장해 주세요)' : ''}`);
  const name = opts.name || String(opts.originalName || 'template').replace(/\.(hwpx?|hwpml)$/i, '');
  let id = opts.id ? slugify(opts.id) : uniqueId(name);
  if (existsSync(templateDir(id)) && !opts.force) throw new Error(`이미 '${id}' 양식이 있습니다. --force로 덮어쓰거나 --id로 다른 이름을 지정하세요.`);
  if (existsSync(templateDir(id)) && opts.force) rmSync(templateDir(id), { recursive: true, force: true });
  const dir = ensureDir(templateDir(id));
  const sourceFile = `source.${fmt}`;
  writeFileSync(join(dir, sourceFile), bytes);
  writeFileSync(join(dir, 'source.md'), parsed.markdown);

  let working = null;
  let workingBytes = fmt === 'hwpx' ? bytes : null;
  if (fmt === 'hwp') {
    try {
      const conv = await convertBytes(bytes, 'hwpx');
      writeFileSync(join(dir, 'working.hwpx'), conv.bytes);
      workingBytes = conv.bytes;
      working = { file: 'working.hwpx', from: `rhwp@${packageVersion('@rhwp/core')}`, contentLoss: conv.loss?.count ?? null };
    } catch (e) {
      working = { error: `HWPX 변환 실패: ${e.message}` };
    }
  }

  let fields = [];
  try {
    if (fmt === 'hwpx') fields = (await k.extractClickHereFields(bytes)).map((f) => ({ name: f.name, placeholder: f.placeholder || '', value: f.value || '' }));
    else fields = await rhwpFieldList(bytes);
  } catch {
    fields = [];
  }

  const slots = detectSlots(parsed.blocks, k);
  const docType = opts.type ? { ...docTypeInfo(opts.type), confidence: 1, evidence: ['사용자 지정'] } : classifyDocType(parsed.blocks, slots, fields);
  const mode = opts.mode || recommendMode(docType.type, slots, fields);

  let profile = null;
  if (workingBytes) {
    try {
      const prof = await k.hwpxToProfile(workingBytes);
      if (prof?.tables?.length) {
        writeFileSync(join(dir, 'profile.json'), JSON.stringify(prof, null, 2));
        profile = 'profile.json';
      }
    } catch {
      /* ignore */
    }
  }

  const sourceCheck = { weekday: checkWeekdays(plainText(parsed.blocks)) };
  try {
    const f = k.lintGongmunText(parsed.markdown, { document: false }) || [];
    sourceCheck.lint = f.length;
  } catch {
    /* ignore */
  }

  if (opts.sampleValues) writeFileSync(join(dir, 'sample-values.json'), JSON.stringify({ template: id, values: opts.sampleValues }, null, 2));

  const card = {
    schema: CARD_SCHEMA,
    id,
    name,
    org: opts.org || '',
    docType,
    mode,
    source: {
      file: sourceFile,
      format: fmt,
      originalName: opts.originalName || null,
      sha256: sha256(bytes),
      bytes: bytes.length,
      pages: parsed.pages?.length ?? parsed.metadata?.pageCount ?? null,
    },
    working,
    fields,
    slots: slots.map(slotForCard),
    entities: findEntities(parsed.blocks),
    outline: parsed.blocks.filter((b) => b.type === 'heading').map((b) => normText(b.text)).filter(Boolean).slice(0, 40),
    style: { preset: docType.preset, profile },
    sourceCheck,
    notes: opts.notes || '',
    createdAt: new Date().toISOString(),
    tools: { skill: SKILL_PKG.version, kordoc: k.VERSION ?? packageVersion('kordoc'), rhwp: packageVersion('@rhwp/core') },
  };
  saveCard(card);
  return card;
}

function cardSummary(card) {
  const counts = card.slots.reduce((m, s) => ((m[s.state] = (m[s.state] || 0) + 1), m), {});
  const lines = [
    `양식: ${card.name}  (ID: ${card.id})`,
    `기관: ${card.org || '-'}   유형: ${card.docType.label}(${card.docType.type}, 확신 ${card.docType.confidence})   추천 모드: ${modeLabel(card.mode)}`,
    `원본: ${card.source.originalName || card.source.file} [${card.source.format.toUpperCase()}${card.source.pages ? `, ${card.source.pages}쪽` : ''}]${card.working?.file ? ` · HWPX 작업본(손실 ${card.working.contentLoss ?? '?'}건)` : ''}`,
    `입력 칸: ${card.slots.length}개 (빈칸 ${counts.empty || 0} · 예시표기 ${counts.placeholder || 0} · 채워짐 ${counts.filled || 0})${card.fields.length ? ` · 누름틀 ${card.fields.length}개` : ''}`,
  ];
  if (card.docType.evidence?.length) lines.push(`유형 근거: ${card.docType.evidence.join(', ')}`);
  const wd = card.sourceCheck?.weekday || [];
  if (wd.length) lines.push(`⚠ 원본 점검: ${wd.map((w) => `“${w.date}” ${w.problem}${w.hint ? ` (${w.hint})` : ''}`).join(', ')}`);
  return lines.join('\n');
}

function modeLabel(m) {
  return { fill: 'fill(빈칸 채우기)', reuse: 'reuse(기존 문서 재활용)', fields: 'fields(누름틀 채우기)' }[m] || m;
}

function slotTable(card, max = 80) {
  const rows = [];
  for (const f of card.fields) rows.push(`  [누름틀] ${f.name}${f.placeholder ? `: ${f.placeholder}` : ''}`);
  for (const s of card.slots.slice(0, max)) {
    const sample = s.kind === 'table' ? `${s.rows.length}행 표` : normText(Array.isArray(s.sample) ? '' : s.sample).replace(/\n/g, ' / ').slice(0, 36);
    const st = { empty: '빈칸', placeholder: '예시', filled: '채움' }[s.state] || s.state;
    rows.push(`  [${s.kind}/${st}] ${s.key}${sample ? ` = “${sample}”` : ''}${s.hint ? `  ⟶ ${s.hint}` : ''}`);
  }
  if (card.slots.length > max) rows.push(`  … 외 ${card.slots.length - max}개 (--json으로 전체 확인)`);
  return rows.join('\n');
}

function valuesSkeleton(card) {
  const values = {};
  const hints = {};
  for (const f of card.fields) {
    values[f.name] = f.value || '';
    hints[f.name] = `누름틀${f.placeholder ? `: ${f.placeholder}` : ''}`;
  }
  for (const s of card.slots) {
    if (s.kind === 'table') values[s.key] = s.sample;
    else if (s.kind === 'choice') values[s.key] = s.options.filter((o) => o.checked).map((o) => o.short).join(', ');
    else values[s.key] = s.state === 'filled' ? normText(s.sample) : '';
    if (s.hint) hints[s.key] = s.hint;
  }
  return { template: card.id, mode: card.mode, values, _hints: hints };
}

function readValues(a) {
  let values = {};
  if (a.values) {
    const txt = a.values === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(a.values), 'utf8');
    const v = JSON.parse(txt);
    values = v && typeof v.values === 'object' && !Array.isArray(v.values) ? { ...v.values } : { ...v };
  }
  for (const s of a.set) {
    const eq = s.indexOf('=');
    if (eq < 1) throw new Error(`--set 형식은 "키=값" 입니다: ${s}`);
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1);
    if (/^\s*[[{]/.test(val) || val === 'true' || val === 'false') {
      try {
        val = JSON.parse(val);
      } catch {
        /* keep string */
      }
    }
    values[key] = val;
  }
  return values;
}

function splitReplace(r) {
  const i = r.indexOf('=>');
  if (i < 1) throw new Error(`--replace 형식은 "옛글=>새글" 입니다: ${r}`);
  return [r.slice(0, i), r.slice(i + 2)];
}

async function missingKeys(k, bytes, applied) {
  const p = await k.parse(Buffer.from(bytes));
  if (!p.success) return applied.map((x) => x.key);
  const txt = squash(plainText(p.blocks));
  const miss = [];
  for (const a of applied) {
    let vals;
    if (a.kind === 'table') vals = a.value.flat().filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    else if (a.kind === 'choice') vals = a.cellTexts || [];
    else vals = [a.value];
    if (vals.some((v) => squash(v) && !txt.includes(squash(v)))) miss.push(a.key);
  }
  return miss;
}

// ③ 라벨 기반 채우기: 표 좌표 매핑이 안 되는 칸을 kordoc fillHwpx로 채운다(라벨이 문서에서 유일한 칸만).
async function labelFill(k, bytes, card, entries) {
  const count = new Map();
  for (const s of card.slots) {
    const l = squash(cleanLabel(s.labelRaw || s.label || ''));
    if (l) count.set(l, (count.get(l) || 0) + 1);
  }
  const map = {};
  const intended = {};
  const skipped = [];
  for (const e of entries) {
    const slot = card.slots.find((s) => s.key === e.key);
    if (!slot || !['cell', 'choice'].includes(slot.kind)) continue;
    const lab = cleanLabel(slot.labelRaw || slot.label || '');
    if (!lab || (count.get(squash(lab)) || 0) > 1 || (slot.kind === 'choice' && (slot.cells?.length || 1) > 1)) {
      skipped.push(e.key);
      continue;
    }
    map[lab] = slot.kind === 'choice' ? e.cellTexts?.[0] : e.value;
    intended[squash(lab)] = squash(slot.labelCell?.text || lab);
  }
  let keys = Object.keys(map).filter((x) => map[x] !== undefined && map[x] !== null);
  const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  for (let attempt = 0; attempt < 4 && keys.length; attempt++) {
    const r = await k.fillHwpx(ab(Buffer.from(bytes)), Object.fromEntries(keys.map((x) => [x, map[x]])));
    const bad = new Set();
    const per = new Map();
    for (const f of r.filled || []) {
      const key = keys.find((x) => squash(x) === squash(f.key || '')) || keys.find((x) => squash(x) === squash(f.label || ''));
      if (!key) continue;
      per.set(key, (per.get(key) || 0) + 1);
      if (squash(f.label || '') !== intended[squash(key)]) bad.add(key);
    }
    for (const [key, n] of per) if (n > 1) bad.add(key);
    if (!bad.size) return { bytes: Buffer.from(r.buffer), filled: [...per.keys()], skipped };
    skipped.push(...bad);
    keys = keys.filter((x) => !bad.has(x));
  }
  return { bytes, filled: [], skipped };
}

// ───────── 명령 ─────────

async function cmdDoctor(a) {
  const info = { skill: SKILL_PKG.version, skillDir: SKILL_DIR, node: process.version, nodeOk: nodeMajor() >= 20, library: libraryRoot(), depsInstalledBefore: depsInstalled() };
  try {
    const k = await loadKordoc();
    info.kordoc = k.VERSION ?? packageVersion('kordoc');
  } catch (e) {
    info.kordocError = e.message;
  }
  try {
    await loadRhwp();
    info.rhwp = packageVersion('@rhwp/core');
  } catch (e) {
    info.rhwpError = e.message;
  }
  try {
    ensureDir(libraryRoot());
    const p = join(libraryRoot(), '.write-test');
    writeFileSync(p, 'ok');
    rmSync(p);
    info.libraryWritable = true;
  } catch (e) {
    info.libraryWritable = false;
    info.libraryError = e.message;
  }
  info.templates = info.libraryWritable ? listCards().length : 0;
  info.ok = Boolean(info.nodeOk && info.kordoc && info.rhwp && info.libraryWritable);
  if (a.json) return outJson(info);
  out(`kofic-hwp-form ${info.skill}  ${info.ok ? '✅ 사용 준비 완료' : '⚠️ 점검 필요'}`);
  out(`- Node.js ${info.node} ${info.nodeOk ? 'OK' : '(20 이상 필요)'}`);
  out(`- kordoc ${info.kordoc ?? `없음: ${info.kordocError}`}`);
  out(`- rhwp(@rhwp/core) ${info.rhwp ?? `없음: ${info.rhwpError}`}`);
  out(`- 양식함 ${info.library} ${info.libraryWritable ? `(양식 ${info.templates}개)` : `쓰기 불가: ${info.libraryError}`}`);
  out(`- 스킬 폴더 ${info.skillDir}`);
}

async function cmdLearn(a) {
  const file = a._[1];
  if (!file) throw new Error('사용법: learn <파일.hwp|hwpx> [--name 이름] [--org 기관] [--type 유형]');
  const abs = resolve(file);
  const bytes = readFileSync(abs);
  const card = await learnFromBytes(bytes, { name: a.name, org: a.org, type: a.type, mode: a.mode, id: a.id, force: a.force, notes: a.notes, originalName: basename(abs) });
  if (a.json) return outJson({ ok: true, card: { ...card, dir: templateDir(card.id) } });
  out(cardSummary(card));
  out(`\n입력 칸 목록:\n${slotTable(card, 40)}`);
  out(`\n저장 위치: ${templateDir(card.id)}`);
  out(`다음 단계: values ${card.id} → 값 채우기 → fill ${card.id} --values 값.json`);
}

async function cmdBuiltin(a) {
  const k = await loadKordoc();
  const name = a._[1];
  if (!name) {
    const list = k.BUILTIN_TEMPLATES.map((t) => ({ id: t.id, title: t.title, aliases: t.aliases }));
    if (a.json) return outJson(list);
    out('내장 표준 서식 (kordoc):');
    for (const t of list) out(`- ${t.id}: ${t.title}`);
    out('등록: builtin gian  또는  builtin gian-simple');
    return;
  }
  const t = k.resolveBuiltinTemplate(name);
  if (!t) throw new Error(`내장 서식 '${name}'이 없습니다. (gian | gian-simple)`);
  const bytes = Buffer.from(await k.readBuiltinTemplate(t));
  let sampleValues = null;
  try {
    sampleValues = await k.readBuiltinTemplateSample(t);
  } catch {
    /* ignore */
  }
  const card = await learnFromBytes(bytes, { name: a.name || t.title.split('—')[0].trim(), org: a.org, type: a.type || 'official', id: a.id || t.id, force: a.force, originalName: t.file, sampleValues });
  if (a.json) return outJson({ ok: true, card });
  out(cardSummary(card));
  out(`\n누름틀: ${card.fields.map((f) => f.name).join(', ')}`);
  if (sampleValues) out(`예시 값: ${join(templateDir(card.id), 'sample-values.json')}`);
}

async function cmdList(a) {
  const cards = listCards();
  if (a.json) return outJson(cards.map((c) => ({ id: c.id, name: c.name, org: c.org, docType: c.docType?.type, mode: c.mode, format: c.source?.format, slots: c.slots?.length, fields: c.fields?.length, updatedAt: c.updatedAt })));
  if (!cards.length) return out(`양식함이 비어 있습니다 (${libraryRoot()}). learn <파일>로 양식을 등록하세요.`);
  out(`양식함: ${libraryRoot()}`);
  for (const c of cards) out(`- ${c.id} | ${c.name} | ${c.docType?.label} | ${modeLabel(c.mode)} | ${c.source?.format?.toUpperCase()} | 칸 ${c.slots?.length}${c.fields?.length ? ` · 누름틀 ${c.fields.length}` : ''}`);
}

async function cmdShow(a) {
  const card = loadCard(a._[1]);
  if (a.md) return out(readFileSync(join(card.dir, 'source.md'), 'utf8'));
  if (a.json) return outJson(card);
  out(cardSummary(card));
  if (card.outline?.length) out(`목차: ${card.outline.slice(0, 12).join(' / ')}`);
  if (card.notes) out(`메모: ${card.notes}`);
  out(`\n입력 칸:\n${slotTable(card, 200)}`);
  if (card.entities?.length) out(`\n자주 바뀌는 값 후보(날짜·금액·번호·연락처): ${card.entities.slice(0, 15).map((e) => e.value).join(', ')}`);
  out(`\n원문 마크다운: ${join(card.dir, 'source.md')}`);
}

async function cmdValues(a) {
  const card = loadCard(a._[1]);
  const sk = valuesSkeleton(card);
  const target = a.out ? resolve(a.out) : null;
  if (target) {
    ensureDir(dirname(target));
    writeFileSync(target, JSON.stringify(sk, null, 2) + '\n');
    if (a.json) return outJson({ ok: true, path: target });
    return out(`입력값 틀 저장: ${target}\n빈 문자열("")은 그대로 두면 칸이 바뀌지 않습니다.`);
  }
  outJson(sk);
}

async function cmdFill(a) {
  const card = loadCard(a._[1]);
  const k = await loadKordoc();
  const srcBytes = readFileSync(join(card.dir, card.source.file));
  const values = readValues(a);
  const parsed = await k.parse(srcBytes);
  if (!parsed.success) throw new Error(`양식 원본을 읽지 못했습니다: ${parsed.error}`);
  const blocks = structuredClone(parsed.blocks);
  const replaced = [];
  let md;
  let res;
  const attachField = (card.fields || []).find((f) => squash(f.name) === '붙임');
  const attachmentSuffix = Boolean(attachField) && paragraphAppendsAttachmentUnit(parsed.markdown || '', attachField.value || '');
  const applyOpts = { attachmentSuffix };
  if (a.editMd) {
    md = readFileSync(resolve(a.editMd), 'utf8');
    res = applyValues(structuredClone(parsed.blocks), { ...card, slots: [] }, values, applyOpts);
    if (res.unknown.length) throw new Error(`--edit-md와 함께 쓸 수 있는 값은 누름틀뿐입니다. 표 칸 값은 편집본 마크다운에 직접 넣으세요: ${res.unknown.join(', ')}`);
  } else {
    res = applyValues(blocks, card, values, applyOpts);
    for (const r of a.replace) {
      const [from, to] = splitReplace(r);
      replaced.push({ from, to, count: replaceEverywhere(blocks, from, to) });
    }
    md = k.blocksToMarkdown(blocks);
  }
  const problems = [];
  if (res.unknown.length) problems.push(`양식에 없는 키: ${res.unknown.join(', ')}`);
  for (const amb of res.ambiguous) problems.push(`'${amb.key}'가 여러 칸과 겹칩니다 → 정확한 키 중 선택: ${amb.candidates.join(' | ')}`);
  for (const e of res.errors) problems.push(`'${e.key}': ${e.error}`);
  for (const r of replaced) if (!r.count) problems.push(`치환 대상 '${r.from}'을(를) 문서에서 찾지 못했습니다.`);
  if (problems.length && !a.force) {
    const msg = `값을 적용하지 못했습니다(파일을 만들지 않음):\n- ${problems.join('\n- ')}\n키 목록은 'show ${card.id}' 또는 'values ${card.id}'로 확인하세요. (--force: 문제 항목을 건너뛰고 진행)`;
    if (a.json) {
      outJson({ ok: false, problems });
      process.exitCode = 1;
      return;
    }
    throw new Error(msg);
  }

  const bodyChanged = Boolean(a.editMd) || res.applied.length > 0 || replaced.some((r) => r.count > 0);
  let outBytes = srcBytes;
  let patch = null;
  let outFormat = card.source.format;
  let route = 'direct';
  let labelFillReport = null;
  if (bodyChanged) {
    patch = outFormat === 'hwp' ? await k.patchHwp(new Uint8Array(srcBytes), md) : await k.patchHwpx(new Uint8Array(srcBytes), md);
    if (!patch.success) throw new Error(`서식 보존 반영 실패: ${patch.error}`);
    outBytes = Buffer.from(patch.data);
    let best = { bytes: outBytes, format: outFormat, patch, res, replaced: [...replaced], route, missing: await missingKeys(k, outBytes, res.applied) };
    // 반영 안 된 칸이 있으면 ② HWPX 작업본 패치 → ③ 라벨 기반 XML 채우기 순서로 자동 복구
    if (best.missing.length && !a.editMd && !a.noFallback) {
      let hx = null;
      if (outFormat === 'hwp' && card.working?.file) {
        const wBytes = readFileSync(join(card.dir, card.working.file));
        const wParsed = await k.parse(wBytes);
        if (wParsed.success) {
          const wBlocks = structuredClone(wParsed.blocks);
          const res2 = applyValues(wBlocks, card, values, applyOpts);
          const replaced2 = [];
          for (const r of a.replace) {
            const [from, to] = splitReplace(r);
            replaced2.push({ from, to, count: replaceEverywhere(wBlocks, from, to) });
          }
          const patch2 = await k.patchHwpx(new Uint8Array(wBytes), k.blocksToMarkdown(wBlocks));
          if (patch2.success && !res2.errors.length) {
            const b2 = Buffer.from(patch2.data);
            hx = { bytes: b2, format: 'hwpx', patch: patch2, res: res2, replaced: replaced2, route: 'hwpx-fallback', missing: await missingKeys(k, b2, res2.applied) };
          }
        }
      } else if (outFormat === 'hwpx') {
        hx = { ...best };
      }
      if (hx && hx.missing.length < best.missing.length) best = hx;
      if (hx && hx.missing.length) {
        const lf = await labelFill(k, hx.bytes, card, hx.res.applied.filter((x) => hx.missing.includes(x.key)));
        if (lf.filled.length) {
          const miss3 = await missingKeys(k, lf.bytes, hx.res.applied);
          if (miss3.length < best.missing.length) {
            best = { ...hx, bytes: lf.bytes, route: `${hx.route}+label-fill`, missing: miss3 };
            labelFillReport = lf;
          }
        }
      }
    }
    outBytes = best.bytes;
    outFormat = best.format;
    patch = best.patch;
    res = best.res;
    replaced.splice(0, replaced.length, ...best.replaced);
    route = best.route;
    if (route !== 'direct') note(`일부 칸이 직접 반영되지 않아 복구 경로(${route})로 다시 반영했습니다.`);
  }
  let fieldReport = null;
  const fv = res.fieldValues || {};
  if (Object.keys(fv).length) {
    if (outFormat === 'hwpx') {
      const f = await k.fillForm(outBytes, fv, 'hwpx-preserve');
      outBytes = Buffer.from(f.output);
      fieldReport = { filled: (f.fill?.filled || []).map((x) => x.key || x.label), unmatched: f.fill?.unmatched || [] };
      for (const [name, value] of Object.entries(fv)) res.applied.push({ key: name, kind: 'field', value: String(value) });
    } else {
      const r = await rhwpSetFields(outBytes, fv);
      outBytes = r.bytes;
      fieldReport = { results: r.results };
      for (const [name, value] of Object.entries(fv)) res.applied.push({ key: name, kind: 'field', value: String(value) });
    }
  }
  // 출력 형식 정책: HWP 직접 반영이 모두 성공하면 HWP 유지. 복구 경로를 거쳤으면 HWPX로 저장(한글에서 열어 HWP로 저장 권장).
  const explicit = a.format && a.format !== 'same' ? String(a.format).toLowerCase() : null;
  const outExt = a.out && /\.(hwpx?)$/i.test(a.out) ? extname(a.out).slice(1).toLowerCase() : null;
  let want = explicit;
  let formatNotice = null;
  if (!want) {
    if (route !== 'direct' && card.source.format === 'hwp') {
      want = 'hwpx';
      formatNotice = '원본은 HWP지만 일부 칸이 HWP 직접 반영을 지원하지 않아 HWPX로 저장했습니다. 한글에서 열어 확인한 뒤 필요하면 [다른 이름으로 저장 → HWP]로 저장하세요. (강제로 HWP가 필요하면 --format hwp)';
    } else want = outExt || card.source.format;
  }
  let conversion = null;
  if (want !== outFormat) {
    const conv = await convertBytes(outBytes, want);
    outBytes = conv.bytes;
    conversion = { from: outFormat, to: want, contentLoss: conv.loss?.count ?? null };
    if (want === 'hwp') conversion.warning = 'rhwp로 HWPX→HWP 변환(줄 배치 재계산 포함)한 파일입니다. 제출 전 한글에서 한 번 열어 확인하세요.';
    outFormat = want;
  }
  let outPath = a.out ? resolve(a.out) : join(outputsDir(), `${timestamp()}_${card.id}.${outFormat}`);
  if (extname(outPath).toLowerCase() !== `.${outFormat}`) outPath = outPath.replace(/\.[^./\\]*$/, '') + `.${outFormat}`;
  ensureDir(dirname(outPath));
  writeFileSync(outPath, outBytes);

  let report = null;
  if (!a.noVerify) {
    report = await verifyDocument(k, { outBytes, outFormat, srcBytes, card, applied: res.applied, replaced, patch });
    report.fields = fieldReport;
    if (!report.pages) report.pages = await rhwpPageCount(outBytes);
    report.conversion = conversion;
    report.formatNotice = formatNotice;
    report.route = route;
    report.labelFill = labelFillReport ? { filled: labelFillReport.filled, skipped: labelFillReport.skipped } : null;
    report.output = outPath;
    report.skippedSame = res.skippedSame;
    writeFileSync(`${outPath}.report.json`, JSON.stringify(report, null, 2) + '\n');
  }
  if (report && !report.ok) process.exitCode = 2;
  if (a.json) return outJson({ ok: report ? report.ok : true, output: outPath, format: outFormat, route, formatNotice, conversionWarning: conversion?.warning ?? null, applied: res.applied.map((x) => x.key), problems, report });
  out(`완성: ${outPath}`);
  if (route !== 'direct') out(`경로: 직접 반영에서 일부 칸 불가 → ${route.includes('hwpx-fallback') ? 'HWPX 작업본 반영' : ''}${route.includes('label-fill') ? ' → 라벨 기반 채우기' : ''}${conversion ? ' → HWP 재변환' : ''}`);
  out(`적용 ${res.applied.length}건${res.skippedSame.length ? ` · 변경 없음 ${res.skippedSame.length}건` : ''}${replaced.length ? ` · 전체 치환 ${replaced.map((r) => `${r.from}→${r.to}(${r.count})`).join(', ')}` : ''}${conversion ? ` · ${conversion.from.toUpperCase()}→${conversion.to.toUpperCase()} 변환(손실 ${conversion.contentLoss ?? '?'}건)` : ''}`);
  if (formatNotice) out(`안내: ${formatNotice}`);
  if (conversion?.warning) out(`주의: ${conversion.warning}`);
  if (problems.length) out(`건너뛴 항목:\n- ${problems.join('\n- ')}`);
  if (report) {
    out(summarizeReport(report));
    out(`검수 보고서: ${outPath}.report.json`);
  }
}

async function cmdGenerate(a) {
  const k = await loadKordoc();
  const mdPath = a.md || a._[1];
  if (!mdPath) throw new Error('사용법: generate --md 원고.md [--template ID] [--preset 유형]');
  const md = mdPath === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(mdPath), 'utf8');
  const card = a.template ? loadCard(a.template) : null;
  const preset = a.preset || card?.style?.preset || 'report';
  const gongmun = { preset };
  if (a.approval) gongmun.approval = String(a.approval).split(',').map((s) => s.trim()).filter(Boolean);
  if (a.options) {
    const txt = String(a.options).trim().startsWith('{') ? a.options : readFileSync(resolve(a.options), 'utf8');
    Object.assign(gongmun, JSON.parse(txt));
  }
  const opts = { gongmun };
  if (card?.style?.profile && a.profile) {
    try {
      opts.profile = JSON.parse(readFileSync(join(card.dir, card.style.profile), 'utf8'));
    } catch {
      /* ignore */
    }
  }
  let outBytes = Buffer.from(await k.markdownToHwpx(md, opts));
  let outFormat = 'hwpx';
  let want = a.format ? String(a.format).toLowerCase() : null;
  if (!want && a.out && /\.(hwpx?)$/i.test(a.out)) want = extname(a.out).slice(1).toLowerCase();
  let conversion = null;
  if (want === 'hwp') {
    const conv = await convertBytes(outBytes, 'hwp');
    outBytes = conv.bytes;
    outFormat = 'hwp';
    conversion = { from: 'hwpx', to: 'hwp', contentLoss: conv.loss?.count ?? null, warning: 'rhwp로 HWPX→HWP 변환(줄 배치 재계산 포함)한 파일입니다. 제출 전 한글에서 한 번 열어 확인하세요.' };
  }
  let outPath = a.out ? resolve(a.out) : join(outputsDir(), `${timestamp()}_${card ? card.id : slugify(preset)}_generated.${outFormat}`);
  if (extname(outPath).toLowerCase() !== `.${outFormat}`) outPath = outPath.replace(/\.[^./\\]*$/, '') + `.${outFormat}`;
  ensureDir(dirname(outPath));
  writeFileSync(outPath, outBytes);
  const report = await verifyDocument(k, { outBytes, outFormat, card: card ? { ...card, slots: [] } : { docType: { type: preset } }, mode: 'generate' });
  report.conversion = conversion;
  if (!report.pages) report.pages = await rhwpPageCount(outBytes);
  report.output = outPath;
  report.preset = preset;
  report.profileApplied = Boolean(opts.profile);
  writeFileSync(`${outPath}.report.json`, JSON.stringify(report, null, 2) + '\n');
  if (a.json) return outJson({ ok: report.ok, output: outPath, report });
  out(`생성: ${outPath}  (프리셋 ${preset}${opts.profile ? ' · 표 서식 프로필 전달(같은 구조의 표에만 적용)' : ''})`);
  out(summarizeReport(report));
  if (conversion?.warning) out(`주의: ${conversion.warning}`);
}

async function cmdVerify(a) {
  const k = await loadKordoc();
  const file = a._[1];
  if (!file) throw new Error('사용법: verify <파일> [--template ID]');
  const bytes = readFileSync(resolve(file));
  const card = a.template ? loadCard(a.template) : null;
  const srcBytes = card ? readFileSync(join(card.dir, card.source.file)) : null;
  const fmt = detectFormat(k, bytes, file);
  const report = await verifyDocument(k, { outBytes: bytes, outFormat: fmt, srcBytes, card });
  if (a.json) return outJson(report);
  out(summarizeReport(report));
}

async function cmdConvert(a) {
  const file = a._[1];
  const to = String(a.to || '').toLowerCase();
  if (!file || !['hwp', 'hwpx'].includes(to)) throw new Error('사용법: convert <파일> --to hwpx|hwp [--out 파일]');
  const bytes = readFileSync(resolve(file));
  const conv = await convertBytes(bytes, to);
  const outPath = a.out ? resolve(a.out) : resolve(file).replace(/\.[^./\\]*$/, '') + `.${to}`;
  if (outPath === resolve(file)) throw new Error('원본과 같은 경로에는 쓸 수 없습니다. --out을 지정하세요.');
  writeFileSync(outPath, conv.bytes);
  const k = await loadKordoc();
  let validation = null;
  if (to === 'hwpx') validation = await k.validateHwpx(conv.bytes);
  if (a.json) return outJson({ ok: true, output: outPath, contentLoss: conv.loss, validation });
  out(`변환: ${outPath}  (내용 손실 보고 ${conv.loss?.count ?? '?'}건${validation ? `, 구조 ${validation.ok ? '정상' : '오류'}` : ''})`);
  if (to === 'hwp') out('참고: rhwp 변환본(줄 배치 재계산 포함)입니다. 제출 전 한글에서 한 번 열어 확인하세요.');
}

function parsePages(spec) {
  const pages = new Set();
  for (const part of String(spec).split(',')) {
    const [s, e] = part.split('-').map((x) => parseInt(x, 10));
    if (Number.isFinite(s)) for (let p = s; p <= (Number.isFinite(e) ? e : s); p++) pages.add(p);
  }
  return [...pages].sort((x, y) => x - y);
}

async function renderPreview(k, bytes, pages) {
  const opts = { format: 'svg', ...(pages ? { pages } : {}) };
  const prepared = await preparePreviewBytes(bytes);
  if (prepared !== bytes) {
    try {
      return await k.renderDocument(prepared, opts);
    } catch (e) {
      note(`줄바꿈 보정 미리보기에 실패해 원본 조판으로 그립니다: ${e.message}`);
    }
  }
  return k.renderDocument(bytes, opts);
}

async function cmdPreview(a) {
  const k = await loadKordoc();
  const file = a._[1];
  if (!file) throw new Error('사용법: preview <파일> [--pages 1-3] [--out-dir 폴더] [--png]');
  const abs = resolve(file);
  const bytes = readFileSync(abs);
  const pages = a.pages ? parsePages(a.pages) : undefined;
  const r = await renderPreview(k, bytes, pages);
  const outDir = ensureDir(a.outDir ? resolve(a.outDir) : join(dirname(abs), `${basename(abs).replace(/\.[^.]+$/, '')}_preview`));
  const files = [];
  (r.assets || []).forEach((as, i) => {
    const n = pages ? pages[i] : i + 1;
    const f = join(outDir, `page-${String(n).padStart(2, '0')}.svg`);
    writeFileSync(f, as.svg ?? as.data);
    files.push(f);
  });
  const html = `<!doctype html><meta charset="utf-8"><title>${basename(abs)} 미리보기</title><style>body{background:#e5e5e5;margin:0;padding:16px;font-family:sans-serif}figure{margin:0 auto 18px;max-width:900px;background:#fff;box-shadow:0 1px 4px #0003}figcaption{font-size:13px;color:#555;padding:6px 10px}img{width:100%;display:block}p.note{max-width:900px;margin:0 auto 12px;color:#444;font-size:14px}</style><h3>${basename(abs)}</h3><p class="note">${PREVIEW_NOTE}</p>${files.map((f) => `<figure><figcaption>${basename(f)}</figcaption><img src="${basename(f)}"></figure>`).join('')}`;
  const htmlPath = join(outDir, 'preview.html');
  writeFileSync(htmlPath, html);
  const png = [];
  let pngNote = null;
  if (a.png) {
    const chrome = findChrome();
    if (!chrome) pngNote = PNG_SKIP_NOTE;
    else {
      const failed = [];
      for (const svg of files) {
        const pngPath = svg.replace(/\.svg$/i, '.png');
        try {
          screenshotSvg(chrome, svg, pngPath);
          png.push(pngPath);
        } catch (e) {
          failed.push(`${basename(svg)}: ${e.message}`);
        }
      }
      if (!png.length) pngNote = `PNG를 건너뛰었습니다. Chrome 스크린샷에 실패했습니다. ${failed[0] || ''}`.trim();
      else if (failed.length) pngNote = `일부 PNG만 만들었습니다. ${failed.join('; ')}`;
    }
  }
  if (a.json) return outJson({ ok: true, dir: outDir, pages: files, html: htmlPath, approximate: true, png, pngNote });
  out(`미리보기 ${files.length}쪽: ${htmlPath}`);
  out(PREVIEW_NOTE);
  if (pngNote) out(pngNote);
  else if (png.length) out(`PNG ${png.length}쪽: ${png.join(', ')}`);
}

async function cmdLint(a) {
  const k = await loadKordoc();
  const file = a._[1];
  if (!file) throw new Error('사용법: lint <파일.md|txt|hwp|hwpx>');
  let text;
  if (/\.(md|txt)$/i.test(file) || file === '-') text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(file), 'utf8');
  else {
    const p = await k.parse(readFileSync(resolve(file)));
    if (!p.success) throw new Error(p.error);
    text = p.markdown;
  }
  const findings = k.lintGongmunText(text, { document: Boolean(a.document) });
  let munche = [];
  if (a.munche && k.lintMuncheText) munche = k.lintMuncheText(text) || [];
  if (a.json) return outJson({ count: findings.length, findings, munche });
  if (!findings.length && !munche.length) return out('공문서 표기법: 문제 없음');
  for (const f of findings) out(`- [${f.severity}] ${f.rule} ${f.line ? `(${f.line}행)` : ''} “${f.match ?? ''}”: ${f.message}${f.suggest ? ` → ${f.suggest}` : ''}`);
  for (const f of munche) out(`- [문체] ${f.rule ?? ''} “${f.match ?? ''}”: ${f.message ?? ''}`);
}

async function cmdPack(a) {
  const card = loadCard(a._[1]);
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(card.dir)) zip.file(`${card.id}/${f}`, readFileSync(join(card.dir, f)));
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const outPath = a.out ? resolve(a.out) : resolve(`${card.id}.hwpform.zip`);
  writeFileSync(outPath, buf);
  if (a.json) return outJson({ ok: true, output: outPath });
  out(`양식 꾸러미: ${outPath}  (동료는 unpack으로 등록)`);
}

async function cmdUnpack(a) {
  const file = a._[1];
  if (!file) throw new Error('사용법: unpack <파일.zip> [--id 새ID]');
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(readFileSync(resolve(file)));
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const cardEntry = entries.find((f) => /(^|\/)template\.json$/.test(f.name));
  if (!cardEntry) throw new Error('template.json이 없는 꾸러미입니다.');
  const prefix = cardEntry.name.replace(/template\.json$/, '');
  const card = JSON.parse(await cardEntry.async('string'));
  const id = a.id ? slugify(a.id) : existsSync(templateDir(card.id)) && !a.force ? uniqueId(card.id) : card.id;
  const dir = ensureDir(templateDir(id));
  for (const f of entries) {
    if (!f.name.startsWith(prefix)) continue;
    const rel = f.name.slice(prefix.length);
    if (!rel || rel.includes('..') || rel.includes('/') || rel.includes('\\')) continue;
    writeFileSync(join(dir, rel), await f.async('nodebuffer'));
  }
  card.id = id;
  saveCard(card);
  if (a.json) return outJson({ ok: true, id });
  out(`등록 완료: ${id} (${card.name})`);
}

async function cmdRemove(a) {
  removeTemplate(a._[1]);
  if (a.json) return outJson({ ok: true });
  out(`삭제: ${a._[1]}`);
}

async function cmdWhere(a) {
  const info = { library: libraryRoot(), templates: templatesDir(), outputs: outputsDir(), skillDir: SKILL_DIR };
  if (a.json) return outJson(info);
  out(`양식함: ${info.library}\n템플릿: ${info.templates}\n결과물: ${info.outputs}\n스킬: ${info.skillDir}`);
}

const COMMANDS = {
  doctor: cmdDoctor,
  learn: cmdLearn,
  builtin: cmdBuiltin,
  list: cmdList,
  show: cmdShow,
  values: cmdValues,
  fill: cmdFill,
  generate: cmdGenerate,
  gen: cmdGenerate,
  verify: cmdVerify,
  convert: cmdConvert,
  preview: cmdPreview,
  lint: cmdLint,
  pack: cmdPack,
  unpack: cmdUnpack,
  remove: cmdRemove,
  where: cmdWhere,
};

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (!cmd || cmd === 'help' || a.help) return out(HELP);
  const fn = COMMANDS[cmd];
  if (!fn) throw new Error(`알 수 없는 명령: ${cmd}\n\n${HELP}`);
  if (['show', 'values', 'fill', 'pack', 'remove'].includes(cmd) && !a._[1]) throw new Error(`사용법: ${cmd} <양식ID>: 'list'로 ID를 확인하세요.`);
  await fn(a);
}

main().catch((e) => {
  const json = process.argv.includes('--json');
  if (json) outJson({ ok: false, error: e.message });
  else process.stderr.write(`오류: ${e.message}\n`);
  if (!process.exitCode) process.exitCode = 1;
  if (process.env.HWPFORM_DEBUG) note(e.stack);
});
