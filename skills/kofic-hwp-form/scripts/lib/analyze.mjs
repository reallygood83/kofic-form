// 양식 분석: 입력 칸(slot) 탐지, 문서 유형 분류, 모드 추천
// kordoc IRBlock(표 셀 격자 포함)을 입력으로 받는 순수 함수들이다.

export const BOX_CHARS = '□■☐☑☒▢▣';
const BOX_RE = /[□■☐☑☒▢▣]/;
const BULLET_ONLY_RE = /^\s*(?:[○●◦ㅇ•·∙\-–—※*▶▷►◆◇]|\d{1,2}[.)]|[①-⑳]|[가-하][.)]|\(\d{1,2}\)|\([가-하]\))\s*$/;
const LEAD_MARK_RE = /^(?:[\s○●◦ㅇ•·∙\-–—※*▶▷►◆◇]+|\d{1,2}[.)]\s*|[①-⑳]\s*|[가-하][.)]\s*|\(\d{1,2}\)\s*|\([가-하]\)\s*)+/;
const SECTION_RE = /^\s*(?:\d{1,2}[.)]|[①-⑳]|[IVX]+[.)]|[Ⅰ-Ⅻ][.)]?|[가-하][.)]|□)\s*\S/;

export function normText(s) {
  return String(s ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

export function squash(s) {
  return normText(s).replace(/\s+/g, '');
}

export function cleanLabel(s) {
  let t = normText(s).replace(/\n+/g, ' ');
  t = t.replace(LEAD_MARK_RE, '');
  t = t.replace(/\[(?:필수|선택)[^\]]*\]/g, '').replace(/\s*[:：]\s*$/, '').trim();
  if (/^(?:[가-힣]\s){1,}[가-힣]$/.test(t)) t = t.replace(/\s/g, ''); // "공 고 명" → "공고명"
  return t.replace(/\s{2,}/g, ' ').trim();
}

export function cleanSection(s) {
  let t = normText(s).split('\n')[0];
  t = t.replace(LEAD_MARK_RE, '');
  t = t.replace(/\[[^\]]*\]/g, '').replace(/\s[*※☞].*$/, '').replace(/[*※☞].*$/, '');
  t = t.replace(/\s*[(（][^)）]*(?:경우|해당|선택|필수|작성|기재)[^)）]*[)）]\s*$/, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t.length > 30 ? t.slice(0, 30).trim() : t;
}

// 셀/문자열이 "아직 안 채운 칸"인지 판별한다. null이면 실제 내용.
export function placeholderKind(text) {
  const t = normText(text);
  if (!t) return 'empty';
  if (/^\(?\s*(?:인|서명|서명\s*또는\s*인|날인)\s*\)?$/.test(t)) return 'sign';
  if (/Y{2,4}\s*[년.\-/]|\bM{1,2}\s*[월.\-/]|\bD{1,2}\s*일|^(?:20\d\d\s*)?년\s+월\s+일$|^\s*\.\s+\.\s*$/.test(t)) return 'date';
  if (/^@$/.test(t) || (/^[^@\s]*\s*@\s*[^@\s]*$/.test(t) && !/[A-Za-z0-9]@[A-Za-z0-9]/.test(t))) return 'email';
  const stripped = t.replace(/\([^)]*\)/g, '').replace(/\s/g, '');
  if (stripped && /^[0０Oo○◯xX×\-.,:~/]+$/.test(stripped) && (stripped.match(/[0０Oo○◯xX×]/g) || []).length >= 2) return 'pattern';
  if (/^성명\s*\/\s*\(\s*남\s*\/\s*여\s*\)/.test(t)) return 'pattern';
  if (/^\([^)]*(?:기재|입력|표기|병기|작성|기입|선택|예시|해당시)[^)]*\)$/.test(t)) return 'hint';
  if (/(?:OOO|○○○|ㅇㅇㅇ|△△△|◯◯◯|xxx|XXX)/.test(t) && t.length <= 40) return 'example';
  return null;
}

export function isLabelLike(text) {
  const t = normText(text);
  if (!t) return false;
  if (placeholderKind(t)) return false;
  if (BOX_RE.test(t)) return false;
  if (BULLET_ONLY_RE.test(t)) return false;
  const one = t.replace(/\n/g, ' ');
  if (one.length > 40) return false;
  if (t.split('\n').length > 3) return false;
  const digits = (one.match(/\d/g) || []).length;
  if (digits > one.length * 0.3) return false;
  if (/[.。]$/.test(one) && one.length > 15) return false; // 문장형
  return true;
}

// kordoc 표 격자(병합 셀은 앵커 + 빈 자리 셀)를 앵커 목록으로 변환
export function tableAnchors(table) {
  const rows = table.rows ?? table.cells?.length ?? 0;
  const cols = table.cols ?? Math.max(0, ...(table.cells || []).map((r) => r.length));
  const covered = Array.from({ length: rows }, () => Array(cols).fill(null));
  const anchors = [];
  for (let r = 0; r < rows; r++) {
    const row = table.cells[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (covered[r]?.[c]) continue;
      const cell = row[c];
      if (!cell) continue;
      const cs = Math.max(1, cell.colSpan || 1);
      const rs = Math.max(1, cell.rowSpan || 1);
      const a = { r, c, cs, rs, text: cell.text ?? '' };
      anchors.push(a);
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          if (r + dr < rows && c + dc < cols) covered[r + dr][c + dc] = a;
        }
      }
    }
  }
  return { anchors, covered, rows, cols };
}

const BOX_ONE = /[□■☐☑☒▢▣]/;
const OPT_SEP = /[\n/,，|]/;

function cleanOption(label) {
  let t = normText(label).replace(/\n/g, ' ');
  while (t.endsWith(')') && (t.match(/\)/g) || []).length > (t.match(/\(/g) || []).length) t = t.slice(0, -1).trim();
  while (t.startsWith('(') && (t.match(/\(/g) || []).length > (t.match(/\)/g) || []).length) t = t.slice(1).trim();
  return t;
}

// 체크박스 선택지 파싱: "□ 일반(…)" 앞 표기, "흑백 □ / 칼라 □" 뒤 표기, "( ■체결, □미체결)" 한 줄 표기 모두 지원
export function parseOptions(text) {
  const t = String(text ?? '');
  const boxes = [];
  for (let i = 0; i < t.length; i++) if (BOX_ONE.test(t[i])) boxes.push(i);
  if (!boxes.length) return [];
  const scan = (from, dir) => {
    let depth = 0;
    let out = '';
    for (let p = from; p >= 0 && p < t.length; p += dir) {
      const ch = t[p];
      if (BOX_ONE.test(ch)) break;
      if (ch === (dir > 0 ? '(' : ')') || ch === (dir > 0 ? '（' : '）')) depth += 1;
      else if (ch === (dir > 0 ? ')' : '(') || ch === (dir > 0 ? '）' : '（')) depth = Math.max(0, depth - 1);
      else if (depth === 0 && OPT_SEP.test(ch)) break;
      out = dir > 0 ? out + ch : ch + out;
    }
    return out;
  };
  const postfix = !normText(scan(boxes[0] + 1, 1)) && normText(scan(boxes[0] - 1, -1)).length > 0;
  return boxes.map((pos) => {
    const label = cleanOption(postfix ? scan(pos - 1, -1) : scan(pos + 1, 1));
    const short = normText(label.split(/[(（]/)[0]) || label;
    return { label, short, checked: /[■☑☒▣]/.test(t[pos]) };
  });
}

function sectionBefore(blocks, i) {
  for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
    const b = blocks[j];
    if (!b) continue;
    if (b.type === 'table') break;
    const txt = b.text || '';
    if (b.type === 'heading' || (b.type === 'paragraph' && SECTION_RE.test(txt))) {
      const s = cleanSection(txt);
      if (s) return s;
    }
  }
  return '';
}

function isGridTable(anchors) {
  const head = anchors.filter((a) => a.r === 0);
  if (head.length < 3) return false;
  if (!head.every((a) => normText(a.text) && isLabelLike(a.text))) return false;
  const dataRows = new Set(anchors.filter((a) => a.r > 0).map((a) => a.r));
  return dataRows.size >= 1;
}

function stateOf(text) {
  const pk = placeholderKind(text);
  if (pk === 'empty') return { state: 'empty', placeholder: null };
  if (pk) return { state: 'placeholder', placeholder: pk };
  return { state: 'filled', placeholder: null };
}

export function inferType(label, sample, k) {
  const L = `${label} ${sample ?? ''}`;
  if (/사업자\s*등록\s*번호|^\d{3}-\d{2}-\d{5}$/.test(L)) return 'bizno';
  if (/주민\s*등록\s*번호|생년월일/.test(L)) return 'rrn';
  if (/이메일|전자\s*우편|e-?mail|@/i.test(L)) return 'email';
  if (/연락처|전화|휴대|팩스|FAX|☎/i.test(L)) return 'phone';
  if (/일시|일자|기간|날짜|신고일|예정월|년\s*월|YYYY|MM월/.test(L)) return 'date';
  if (/금액|비용|예산|사업비|제작비|\(원\)|원\)|[0-9,]+원/.test(L)) return 'amount';
  if (/성명|대표자|담당자|감독|작가|프로듀서/.test(L)) return 'person';
  try {
    if (k?.inferFieldType) {
      const t = k.inferFieldType(label, sample ?? '');
      if (t && t !== 'text') return t;
    }
  } catch {
    /* ignore */
  }
  return 'text';
}

const LABEL_VOCAB = /(?:성명|이름|소속|직위|직급|직책|부서|연락처|전화번호|휴대전화|팩스|주소|이메일|전자우편|기관명|회사명|업체명|상호|대표자|담당자|사업명|과제명|공고명|용역명|교육명|행사명|작품명|제목|목적|기간|일시|일자|장소|금액|예산|사업비|인원|대상|방법|비고|수신|참조|발신|시행일|생년월일)$/;

function choiceSlot(bi, tableNo, group, label, section, labelCell, labelRaw) {
  const cells = group.map((g) => ({ r: g.r, c: g.c, text: g.text }));
  const options = [];
  cells.forEach((cell, ci) => {
    parseOptions(cell.text).forEach((o, n) => options.push({ ...o, cell: ci, nth: n }));
  });
  if (!options.length) return null;
  // □를 글머리표로 쓴 안내문·동의문은 선택 칸이 아니다
  const lead = normText(String(cells[0].text).split(/[□■☐☑☒▢▣]/)[0]);
  const avg = options.reduce((n, o) => n + o.label.length, 0) / options.length;
  if (options.length === 1 && /삽입|첨부|스캔|붙여|붙임/.test(options[0].label)) return null;
  if (/참고\s*사항|작성\s*요령|유의\s*사항|안내|주의\s*사항/.test(label || labelRaw || '')) return null;
  const instr = options.filter((o) => /(?:작성|기재|입력|삽입|첨부|표시|활용|참고|요망|바람)\s*[/.]?$|글꼴|폰트|크기/.test(o.label)).length;
  if (instr * 2 >= options.length) return null;
  if (options.length > 10 || avg > 30 || options.some((o) => o.label.length > 35) || lead.length > 40) return null;
  const single = /택\s*1|하나|택일/.test(labelRaw || '');
  return {
    kind: 'choice',
    block: bi,
    tableNo,
    r: cells[0].r,
    c: cells[0].c,
    cells,
    label,
    labelRaw,
    section,
    options,
    multi: !single && options.length > 1,
    sample: cells.map((c) => c.text).join(' | '),
    state: options.some((o) => o.checked) ? 'filled' : 'empty',
    type: 'choice',
    labelCell,
  };
}

const PARA_KV_RE = /^\s*(?:[○●◦ㅇ•·∙\-–—※*▶]|\d{1,2}[.)]|[①-⑳]|[가-하][.)]|\(\d{1,2}\)|\([가-하]\))?\s*([가-힣A-Za-z][가-힣A-Za-z0-9 ()·/]{0,18}?)\s*[:：]\s*(\S.{0,200})$/;

// 입력 칸 탐지. 반환 slot 공통 필드: kind, label, section, state, sample, type, address
export function detectSlots(blocks, k) {
  const raw = [];
  let tableNo = 0;
  blocks.forEach((b, bi) => {
    if (b.type === 'table' && b.table?.cells) {
      tableNo += 1;
      const { anchors } = tableAnchors(b.table);
      const firstLabel = anchors.find((a) => isLabelLike(a.text));
      const section = sectionBefore(blocks, bi) || (firstLabel ? cleanLabel(firstLabel.text) : '');
      if (isGridTable(anchors)) {
        const headers = anchors.filter((a) => a.r === 0).map((a) => cleanLabel(a.text));
        const dataRows = [...new Set(anchors.filter((a) => a.r > 0).map((a) => a.r))].sort((x, y) => x - y);
        const matrix = dataRows.map((r) => anchors.filter((a) => a.r === r).sort((x, y) => x.c - y.c).map((a) => a.text));
        raw.push({
          kind: 'table',
          block: bi,
          tableNo,
          label: section || headers.slice(0, 3).join('·'),
          section,
          headers,
          rows: dataRows,
          sample: matrix,
          state: matrix.flat().every((t) => placeholderKind(t)) ? 'empty' : 'filled',
          type: 'table',
        });
        return;
      }
      const rowsIdx = [...new Set(anchors.map((a) => a.r))].sort((x, y) => x - y);
      for (const r of rowsIdx) {
        const list = anchors.filter((a) => a.r === r).sort((x, y) => x.c - y.c);
        let prefix = '';
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          const at = normText(a.text);
          if (!at || BULLET_ONLY_RE.test(at)) continue;
          // 라벨 없이 체크박스만 있는 칸(예: □ 동의함) → 이어지는 체크박스 칸과 묶는다
          if (BOX_RE.test(at) && !isLabelLike(at)) {
            const group = [a];
            while (list[i + 1] && BOX_RE.test(normText(list[i + 1].text))) group.push(list[++i]);
            const slot = choiceSlot(bi, tableNo, group, prefix || '', section, null, '');
            if (slot) {
              if (!slot.label) slot.label = cleanLabel(slot.options[0]?.short || '선택');
              raw.push(slot);
            }
            continue;
          }
          if (!isLabelLike(at)) continue;
          const b2 = list[i + 1];
          if (!b2) continue;
          const bt = normText(b2.text);
          const label = prefix ? `${prefix} > ${cleanLabel(at)}` : cleanLabel(at);
          if (BOX_RE.test(bt)) {
            const group = [b2];
            i += 1;
            while (list[i + 1] && BOX_RE.test(normText(list[i + 1].text))) group.push(list[++i]);
            const slot = choiceSlot(bi, tableNo, group, label, section, { r: a.r, c: a.c, text: a.text }, at);
            if (slot) raw.push(slot);
            prefix = '';
            continue;
          }
          const st = stateOf(b2.text);
          const colonLabel = /[:：]\s*$/.test(at);
          const valueLooksValue = bt && !isLabelLike(bt);
          const vocab = LABEL_VOCAB.test(cleanLabel(at)) && !LABEL_VOCAB.test(cleanLabel(bt));
          if (st.state !== 'filled' || colonLabel || valueLooksValue || vocab) {
            raw.push({ kind: 'cell', block: bi, tableNo, r: b2.r, c: b2.c, label, labelRaw: at, section, sample: b2.text, state: st.state, placeholder: st.placeholder, type: inferType(label, b2.text, k), labelCell: { r: a.r, c: a.c, text: a.text } });
            i += 1;
            prefix = '';
            continue;
          }
          // 라벨 다음 칸도 라벨 → 상위 분류로 보고 다음 칸을 이어서 본다.
          prefix = cleanLabel(at);
        }
      }
      return;
    }
    if ((b.type === 'paragraph' || b.type === 'list') && b.text) {
      const lines = normText(b.text).split('\n');
      for (const line of lines) {
        const m = PARA_KV_RE.exec(line);
        if (!m) continue;
        const label = cleanLabel(m[1]);
        const sample = normText(m[2]);
        if (!label || label.length > 20 || sample.length < 2) continue;
        if (/https?:$/i.test(label)) continue;
        raw.push({ kind: 'text', block: bi, label, section: sectionBefore(blocks, bi), sample, state: placeholderKind(sample) ? 'placeholder' : 'filled', type: inferType(label, sample, k) });
      }
    }
  });
  return assignKeys(raw);
}

function assignKeys(slots) {
  const count = new Map();
  for (const s of slots) count.set(s.label, (count.get(s.label) || 0) + 1);
  const used = new Set();
  let tableless = 0;
  for (const s of slots) {
    let key = s.label || `칸${++tableless}`;
    if ((count.get(s.label) || 0) > 1) {
      const ctx = s.section || (s.tableNo ? `표${s.tableNo}` : '');
      if (ctx && ctx !== s.label) key = `${ctx} > ${s.label}`;
    }
    let k2 = key;
    let n = 2;
    while (used.has(k2)) k2 = `${key} #${n++}`;
    used.add(k2);
    s.key = k2;
  }
  return slots;
}

const DOC_TYPES = {
  form: { label: '신청서·서식', preset: 'report', kw: ['신청서', '신청인', '서약서', '확인서', '동의서', '신고서', '제출서류', '양식', '서식', '성명', '생년월일', '연락처', '(인)', '서명', '작성요령'] },
  notice: { label: '공고문', preset: 'notice', kw: ['공고', '모집', '입찰', '공모', '선정 결과', '결과 공지', '알려드립니다', '접수기간', '신청자격', '공고번호', '재공고'] },
  official: { label: '기안문·시행문', preset: 'official', kw: ['수신', '경유', '제목', '시행', '발신명의', '협조', '붙임', '끝.', '관련:', '수신자'] },
  report: { label: '보고서', preset: 'report', kw: ['보고', '검토', '현황', '결과보고', '추진 경과', '향후 계획', '개요', '시사점', '조치사항', '보고서'] },
  plan: { label: '계획서', preset: 'plan', kw: ['계획', '추진계획', '운영계획', '세부 추진', '추진 일정', '소요 예산', '기대효과', '추진 방향', '계획서'] },
  press: { label: '보도자료', preset: 'press', kw: ['보도자료', '보도일시', '배포일시', '보도시점', '담당 부서', '사진자료', '엠바고'] },
  minutes: { label: '회의록', preset: 'minutes', kw: ['회의록', '회의 결과', '참석자', '안건', '의결', '회의일시', '발언'] },
  contract: { label: '계약서', preset: 'official', kw: ['계약서', '계약금액', '계약기간', '위약', '하자', '계약 당사자'] },
};

export function docTypeInfo(type) {
  return DOC_TYPES[type] ? { type, label: DOC_TYPES[type].label, preset: DOC_TYPES[type].preset } : { type: 'other', label: '기타', preset: 'report' };
}

export function listDocTypes() {
  return Object.entries(DOC_TYPES).map(([type, v]) => ({ type, label: v.label }));
}

export function classifyDocType(blocks, slots, fields = []) {
  const firstTexts = [];
  let total = '';
  for (const b of blocks) {
    const t = b.type === 'table' ? (b.table?.cells || []).flat().map((c) => c.text).join(' ') : b.text || '';
    if (firstTexts.length < 4 && t.trim()) firstTexts.push(t);
    total += ' ' + t;
    if (total.length > 4000) break;
  }
  const head = firstTexts.join(' ');
  const scores = {};
  for (const [type, def] of Object.entries(DOC_TYPES)) {
    let s = 0;
    const hits = [];
    for (const kw of def.kw) {
      const inHead = head.includes(kw) ? 3 : 0;
      const inBody = Math.min(3, total.split(kw).length - 1);
      if (inHead || inBody) hits.push(kw);
      s += inHead + inBody;
    }
    scores[type] = { score: s, hits };
  }
  const blank = slots.filter((x) => x.state !== 'filled').length;
  if (blank >= 3) scores.form.score += Math.min(8, blank);
  if (fields.length >= 3) {
    scores.official.score += 3;
    scores.form.score += 2;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);
  const [best, info] = ranked[0];
  const second = ranked[1]?.[1]?.score ?? 0;
  const confidence = info.score === 0 ? 0 : Math.min(1, (info.score - second + 2) / (info.score + 2));
  return {
    ...docTypeInfo(info.score ? best : 'other'),
    confidence: Number(confidence.toFixed(2)),
    evidence: info.hits.slice(0, 8),
    ranking: ranked.slice(0, 4).map(([t, v]) => ({ type: t, score: v.score })),
  };
}

export function recommendMode(docType, slots, fields) {
  const blank = slots.filter((s) => s.state !== 'filled').length;
  const filled = slots.filter((s) => s.state === 'filled').length;
  if (fields.length >= 1 && fields.length >= blank) return 'fields';
  if (docType === 'form' || blank >= Math.max(3, filled)) return 'fill';
  return 'reuse';
}

// 기존 문서 재활용 시 자주 바뀌는 값(날짜·금액·번호·연락처) 위치 힌트
export function findEntities(blocks) {
  const pats = [
    ['date', /(?:20\d{2}|\d{2})\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\s*\.?(?:\s*\([월화수목금토일]\))?/g],
    ['date', /20\d{2}년\s*\d{1,2}월\s*\d{1,2}일/g],
    ['time', /\b\d{1,2}:\d{2}\b/g],
    ['amount', /(?:금\s*)?\d{1,3}(?:,\d{3})+\s*원|금[가-힣]+원정?/g],
    ['docno', /(?:제\s*)?\d{4}\s*-\s*\d{1,4}(?:-\d{1,3})?\s*호/g],
    ['phone', /\b0\d{1,2}-\d{3,4}-\d{4}\b/g],
    ['email', /[\w.+-]+@[\w-]+\.[\w.]+/g],
  ];
  const found = new Map();
  const texts = [];
  blocks.forEach((b) => {
    if (b.type === 'table') (b.table?.cells || []).flat().forEach((c) => texts.push(c.text || ''));
    else texts.push(b.text || '');
  });
  for (const t of texts) {
    for (const [kind, re] of pats) {
      for (const m of t.matchAll(re)) {
        const v = normText(m[0]);
        if (!found.has(v)) found.set(v, { kind, value: v, count: 0 });
        found.get(v).count += 1;
      }
    }
  }
  return [...found.values()].slice(0, 60);
}
