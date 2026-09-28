// 값 적용: 템플릿 slot 주소(표 번호·행·열)에 값을 넣어 IRBlock을 수정한다.
// 수정된 IR은 blocksToMarkdown → patchHwp/patchHwpx 로 원본 파일에 서식 보존 반영된다.
import { cleanLabel, normText, squash, tableAnchors } from './analyze.mjs';

const BOX_G = /[□■☐☑☒▢▣]/g;

export function resolveKeys(slots, fields, values) {
  const matches = [];
  const unknown = [];
  const ambiguous = [];
  const fieldValues = {};
  const fieldNames = new Set((fields || []).map((f) => f.name));
  for (const [key, value] of Object.entries(values || {})) {
    if (key.startsWith('_')) continue;
    if (fieldNames.has(key)) {
      fieldValues[key] = value;
      continue;
    }
    let cand = slots.filter((s) => s.key === key);
    if (!cand.length) cand = slots.filter((s) => s.label === key);
    if (!cand.length) cand = slots.filter((s) => squash(s.key) === squash(key) || squash(s.label) === squash(key));
    if (!cand.length) cand = slots.filter((s) => squash(s.key).endsWith(squash(key)));
    if (!cand.length) cand = slots.filter((s) => squash(cleanLabel(s.labelRaw || '')) === squash(key));
    if (!cand.length) {
      const fk = [...fieldNames].find((n) => squash(n) === squash(key));
      if (fk) {
        fieldValues[fk] = value;
        continue;
      }
      unknown.push(key);
      continue;
    }
    if (cand.length > 1) {
      ambiguous.push({ key, candidates: cand.map((c) => c.key) });
      continue;
    }
    matches.push({ slot: cand[0], value, key });
  }
  return { matches, unknown, ambiguous, fieldValues };
}

function tableOf(blocks, slot) {
  return blocks[slot.block]?.type === 'table' ? blocks[slot.block].table : null;
}

// 저장된 주소가 여전히 맞는지 확인하고, 어긋나면 라벨 셀 글자로 다시 찾는다.
export function locate(blocks, slot) {
  if (slot.kind === 'text') {
    const b = blocks[slot.block];
    if (b && typeof b.text === 'string' && b.text.includes(slot.sample)) return true;
    const i = blocks.findIndex((x) => typeof x.text === 'string' && x.text.includes(slot.sample));
    if (i >= 0) {
      slot.block = i;
      return true;
    }
    return false;
  }
  const t = tableOf(blocks, slot);
  if (slot.kind === 'table') {
    const headOf = (tb) => tableAnchors(tb).anchors.filter((a) => a.r === 0).map((a) => squash(cleanLabel(a.text))).join('|');
    const want = (slot.headers || []).map((h) => squash(h)).join('|');
    if (t && (!want || headOf(t) === want)) return true;
    const i = blocks.findIndex((b) => b.type === 'table' && headOf(b.table) === want);
    if (i >= 0) {
      slot.block = i;
      return true;
    }
    return false;
  }
  const lc = slot.labelCell;
  if (t && lc && squash(t.cells?.[lc.r]?.[lc.c]?.text) === squash(lc.text)) return true;
  if (t && !lc && squash(t.cells?.[slot.r]?.[slot.c]?.text) === squash(slot.sample)) return true;
  if (!lc) return false;
  // 재탐색: 같은 라벨 셀을 가진 표를 찾아 같은 상대 위치의 칸으로 이동
  for (let bi = 0; bi < blocks.length; bi++) {
    const tb = blocks[bi];
    if (tb.type !== 'table') continue;
    const cells = tb.table.cells;
    for (let r = 0; r < cells.length; r++) {
      for (let c = 0; c < cells[r].length; c++) {
        if (squash(cells[r][c].text) !== squash(lc.text)) continue;
        const dr = slot.r - lc.r;
        const dc = slot.c - lc.c;
        if (cells[r + dr]?.[c + dc]) {
          if (slot.cells) slot.cells = slot.cells.map((x) => ({ ...x, r: x.r - slot.r + r + dr, c: x.c - slot.c + c + dc }));
          slot.block = bi;
          slot.labelCell = { ...lc, r, c };
          slot.r = r + dr;
          slot.c = c + dc;
          return true;
        }
      }
    }
  }
  return false;
}

function setCellText(cell, value) {
  if (cell.blocks && cell.blocks.some((b) => b.type === 'table' || b.type === 'image')) {
    throw new Error('이 칸에는 표/그림이 들어 있어 글자만 바꿀 수 없습니다(수동 편집 필요).');
  }
  if (cell.blocks) delete cell.blocks;
  cell.text = String(value);
}

function selectOptions(options, value, multi) {
  let vals;
  if (typeof value === 'boolean') vals = value ? [options[0]?.short] : [];
  else if (Array.isArray(value)) vals = value.map(String);
  else vals = String(value).split(/[,，|]/).map((v) => v.trim()).filter(Boolean);
  const sel = new Set();
  for (const v of vals) {
    const sv = squash(v).replace(/^[□■☐☑☒▢▣]/, '');
    let idx = options.findIndex((o) => squash(o.short) === sv || squash(o.label) === sv);
    if (idx < 0) idx = options.findIndex((o) => squash(o.short).startsWith(sv) || squash(o.label).startsWith(sv));
    if (idx < 0) idx = options.findIndex((o) => squash(o.label).includes(sv));
    if (idx < 0) throw new Error(`선택지 '${v}'가 없습니다. 가능한 값: ${options.map((o) => o.short).join(' | ')}`);
    sel.add(idx);
  }
  if (!multi && sel.size > 1) throw new Error(`한 개만 고르는 항목입니다(선택: ${vals.join(', ')})`);
  return sel;
}

function applyChoice(blocks, slot, value) {
  const t = tableOf(blocks, slot);
  const selected = selectOptions(slot.options, value, slot.multi);
  const cells = slot.cells || [{ r: slot.r, c: slot.c }];
  const texts = [];
  cells.forEach((sc, ci) => {
    const cell = t.cells[sc.r][sc.c];
    const ballot = /[☐☑☒]/.test(cell.text);
    const on = ballot ? '☑' : '■';
    const off = ballot ? '☐' : '□';
    let n = 0;
    const next = cell.text.replace(BOX_G, () => {
      const idx = slot.options.findIndex((o) => o.cell === ci && o.nth === n);
      n += 1;
      return selected.has(idx) ? on : off;
    });
    setCellText(cell, next);
    texts.push(next);
  });
  return { chosen: [...selected].map((i) => slot.options[i].short), texts };
}

function applyTable(blocks, slot, value) {
  if (!Array.isArray(value)) throw new Error('표 항목은 2차원 배열([[행1칸1, 행1칸2], …])로 입력하세요.');
  const t = tableOf(blocks, slot);
  const { anchors } = tableAnchors(t);
  let changed = 0;
  if (value.length > slot.rows.length) throw new Error(`표 행 수(${slot.rows.length})보다 많은 행(${value.length})을 넣을 수 없습니다(행 추가는 한글에서).`);
  value.forEach((rowVals, i) => {
    if (!Array.isArray(rowVals)) return;
    const r = slot.rows[i];
    const rowAnchors = anchors.filter((a) => a.r === r).sort((x, y) => x.c - y.c);
    rowVals.forEach((v, j) => {
      if (v === null || v === undefined) return;
      const a = rowAnchors[j];
      if (!a) throw new Error(`${i + 1}행에는 ${rowAnchors.length}칸만 있습니다.`);
      const cell = t.cells[a.r][a.c];
      if (normText(cell.text) === normText(v)) return;
      setCellText(cell, v);
      changed += 1;
    });
  });
  return changed;
}

function replaceInSpans(spans, from, to) {
  if (!Array.isArray(spans) || !spans.length) return;
  const joined = spans.map((s) => s.text ?? '').join('');
  const pos = joined.indexOf(from);
  if (pos < 0) return;
  let acc = 0;
  for (const s of spans) {
    const len = (s.text ?? '').length;
    if (pos >= acc && pos + from.length <= acc + len) {
      s.text = s.text.slice(0, pos - acc) + to + s.text.slice(pos - acc + from.length);
      return;
    }
    acc += len;
  }
  const merged = joined.slice(0, pos) + to + joined.slice(pos + from.length);
  spans.splice(0, spans.length, { ...spans[0], text: merged });
}

function applyText(blocks, slot, value) {
  const b = blocks[slot.block];
  b.text = b.text.replace(slot.sample, String(value));
  replaceInSpans(b.spans, slot.sample, String(value));
}

export function applyValues(blocks, card, values) {
  const { matches, unknown, ambiguous, fieldValues } = resolveKeys(card.slots || [], card.fields || [], values);
  const applied = [];
  const errors = [];
  const skippedSame = [];
  for (const { slot, value, key } of matches) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '' && slot.kind !== 'table')) continue;
    try {
      if (!locate(blocks, slot)) throw new Error('원본에서 이 칸의 위치를 다시 찾지 못했습니다(양식 파일이 바뀌었는지 확인).');
      if (slot.kind === 'cell') {
        const cell = tableOf(blocks, slot).cells[slot.r][slot.c];
        if (normText(cell.text) === normText(value)) {
          skippedSame.push(slot.key);
          continue;
        }
        setCellText(cell, value);
        applied.push({ key: slot.key, kind: slot.kind, value: String(value), before: slot.sample });
      } else if (slot.kind === 'choice') {
        const { chosen, texts } = applyChoice(blocks, slot, value);
        applied.push({ key: slot.key, kind: slot.kind, value: chosen.join(', '), cellTexts: texts });
      } else if (slot.kind === 'table') {
        const n = applyTable(blocks, slot, value);
        if (n) applied.push({ key: slot.key, kind: slot.kind, value, cells: n });
        else skippedSame.push(slot.key);
      } else if (slot.kind === 'text') {
        if (normText(value) === normText(slot.sample)) {
          skippedSame.push(slot.key);
          continue;
        }
        applyText(blocks, slot, value);
        applied.push({ key: slot.key, kind: slot.kind, value: String(value), before: slot.sample });
      }
    } catch (e) {
      errors.push({ key, error: e.message });
    }
  }
  return { blocks, applied, unknown, ambiguous, errors, skippedSame, fieldValues };
}

// 문서 전체 치환(예: "2026년"→"2027년"). 본문·제목·목록·표 셀 모두 대상.
export function replaceEverywhere(blocks, from, to) {
  let count = 0;
  const visit = (b) => {
    if (typeof b.text === 'string' && b.text.includes(from)) {
      count += b.text.split(from).length - 1;
      b.text = b.text.split(from).join(to);
      if (Array.isArray(b.spans)) for (const s of b.spans) if (typeof s.text === 'string') s.text = s.text.split(from).join(to);
    }
    if (b.table?.cells) {
      for (const row of b.table.cells) {
        for (const cell of row) {
          if (cell.text?.includes(from)) {
            if (cell.blocks) {
              cell.blocks.forEach(visit);
              cell.text = cell.text.split(from).join(to);
            } else {
              count += cell.text.split(from).length - 1;
              cell.text = cell.text.split(from).join(to);
            }
          }
        }
      }
    }
    if (Array.isArray(b.children)) b.children.forEach(visit);
  };
  blocks.forEach(visit);
  return count;
}

export function plainText(blocks) {
  const parts = [];
  const visit = (b) => {
    if (typeof b.text === 'string' && b.type !== 'table') parts.push(b.text);
    if (b.table?.cells) for (const row of b.table.cells) for (const cell of row) parts.push(cell.text ?? '');
    if (Array.isArray(b.children)) b.children.forEach(visit);
  };
  blocks.forEach(visit);
  return parts.join('\n');
}
