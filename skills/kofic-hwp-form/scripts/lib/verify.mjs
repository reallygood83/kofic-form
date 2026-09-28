// 결과 검수: 값 반영 확인, 이전 문서 값 잔존, 미기입 칸, 공문서 표기법, 개인정보, 구조 검증
import { normText, placeholderKind, squash } from './analyze.mjs';
import { locate, plainText } from './apply.mjs';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// "2026. 8. 10.(월)" 처럼 요일이 붙은 날짜가 실제 달력과 맞는지 확인 (복붙으로 연도만 틀리는 사고 방지)
export function checkWeekdays(text) {
  const items = [];
  const re = /((?:19|20)\d{2})\s*[.년]\s*(\d{1,2})\s*[.월]\s*(\d{1,2})\s*[.일]?\s*\(\s*([월화수목금토일])\s*\)/g;
  for (const m of String(text).matchAll(re)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
      items.push({ date: m[0], problem: '존재하지 않는 날짜' });
      continue;
    }
    const real = WEEKDAYS[dt.getUTCDay()];
    if (real !== m[4]) {
      const hint = [y - 1, y + 1].find((yy) => WEEKDAYS[new Date(Date.UTC(yy, mo - 1, d)).getUTCDay()] === m[4]);
      items.push({ date: m[0].replace(/\s+/g, ' '), problem: `${y}. ${mo}. ${d}.은 ${real}요일`, hint: hint ? `${hint}년이라면 ${m[4]}요일 — 연도 확인` : undefined });
    }
  }
  return items;
}

function countOf(hay, needle) {
  if (!needle) return 0;
  return hay.split(needle).length - 1;
}

export async function verifyDocument(k, { outBytes, outFormat, srcBytes, card, applied = [], replaced = [], patch = null, mode = 'fill' }) {
  const report = { ok: true, format: outFormat, mode, checks: {} };
  const parsed = await k.parse(Buffer.from(outBytes));
  if (!parsed.success) {
    report.ok = false;
    report.checks.parse = { ok: false, error: parsed.error };
    return report;
  }
  const outPlain = squash(plainText(parsed.blocks));
  report.pages = parsed.metadata?.pageMode === 'layout' ? parsed.pages?.length ?? null : null;

  // 1) 입력 값 반영 여부
  const missing = [];
  for (const a of applied) {
    const vals = a.kind === 'table' ? a.value.flat().filter((v) => v !== null && v !== undefined) : a.kind === 'choice' ? a.cellTexts || [] : [a.value];
    for (const v of vals) {
      const sv = squash(v);
      if (sv && !outPlain.includes(sv)) missing.push({ key: a.key, value: String(v).slice(0, 40) });
    }
  }
  report.checks.values = { ok: missing.length === 0, applied: applied.length, missing };
  if (missing.length) report.ok = false;

  // 2) 이전 문서 값 잔존(복붙 사고 방지)
  let srcPlain = '';
  if (srcBytes) {
    const sp = await k.parse(Buffer.from(srcBytes));
    if (sp.success) srcPlain = squash(plainText(sp.blocks));
  }
  const stale = [];
  for (const a of applied) {
    if (a.kind !== 'cell' && a.kind !== 'text') continue;
    const before = squash(a.before);
    if (!before || before.length < 4 || placeholderKind(a.before)) continue;
    if (squash(a.value).includes(before)) continue;
    if (countOf(outPlain, before) > 0 && countOf(outPlain, before) >= countOf(srcPlain, before)) {
      stale.push({ key: a.key, previous: normText(a.before).slice(0, 50) });
    }
  }
  for (const r of replaced) {
    if (r.from && outPlain.includes(squash(r.from))) stale.push({ key: '(전체 치환)', previous: r.from });
  }
  report.checks.stale = { ok: stale.length === 0, items: stale };

  // 3) 아직 비어 있거나 예시 표기가 남은 칸
  const unfilled = [];
  if (card?.slots?.length) {
    for (const s0 of card.slots) {
      if (s0.kind !== 'cell' || s0.state === 'filled') continue;
      if (card.mode === 'reuse' && s0.state === 'empty') continue;
      const s = structuredClone(s0);
      if (!locate(parsed.blocks, s)) continue;
      const b = parsed.blocks[s.block];
      const cell = b?.type === 'table' ? b.table.cells?.[s.r]?.[s.c] : null;
      if (!cell) continue;
      const pk = placeholderKind(cell.text);
      if (pk && pk !== 'sign') unfilled.push({ key: s.key, state: pk === 'empty' ? '빈칸' : `예시 표기(${normText(cell.text).slice(0, 20)})` });
    }
    for (const s0 of card.slots) {
      if (s0.kind !== 'choice' || card.mode === 'reuse') continue;
      const s = structuredClone(s0);
      if (!locate(parsed.blocks, s)) continue;
      const b = parsed.blocks[s.block];
      if (b?.type !== 'table') continue;
      const cells = (s.cells || [{ r: s.r, c: s.c }]).map((x) => b.table.cells?.[x.r]?.[x.c]?.text ?? '');
      if (!cells.some((t) => /[■☑☒▣]/.test(t))) unfilled.push({ key: s.key, state: '선택 안 됨' });
    }
  }
  report.checks.unfilled = { count: unfilled.length, items: unfilled.slice(0, 60) };

  // 4) 공문서 표기법(행정업무운영편람) 검수 — 경고 수준
  try {
    const findings = k.lintGongmunText(parsed.markdown, { document: ['official', 'notice', 'press'].includes(card?.docType?.type) }) || [];
    report.checks.lint = {
      count: findings.length,
      errors: findings.filter((f) => f.severity === 'error').length,
      items: findings.slice(0, 25).map((f) => ({ rule: f.rule, severity: f.severity, line: f.line, match: f.match, message: f.message, suggest: f.suggest })),
    };
  } catch (e) {
    report.checks.lint = { error: e.message };
  }

  // 4-1) 날짜-요일 불일치
  const wd = checkWeekdays(plainText(parsed.blocks));
  report.checks.weekday = { ok: wd.length === 0, items: wd };

  // 5) 개인정보 탐지(값은 출력하지 않고 종류별 개수만)
  try {
    const r = k.redactText(plainText(parsed.blocks));
    const byRule = {};
    for (const h of r.hits || []) byRule[h.rule] = (byRule[h.rule] || 0) + 1;
    report.checks.privacy = { count: (r.hits || []).length, byRule };
  } catch (e) {
    report.checks.privacy = { error: e.message };
  }

  // 6) 구조 검증
  if (outFormat === 'hwpx') {
    try {
      const v = await k.validateHwpx(Buffer.from(outBytes));
      report.checks.structure = { ok: v.ok, issues: (v.issues || []).slice(0, 10) };
      if (!v.ok) report.ok = false;
    } catch (e) {
      report.checks.structure = { ok: false, error: e.message };
      report.ok = false;
    }
  } else {
    report.checks.structure = { ok: true, note: 'HWP 5.x 재파싱 성공' };
  }

  // 7) 패치 결과(미적용 편집)
  if (patch) {
    const recovered = (patch.skipped || []).length > 0 && missing.length === 0;
    report.checks.patch = { applied: patch.applied, skipped: (patch.skipped || []).slice(0, 20), recovered, residual: patch.verification?.stats ?? null };
    if ((patch.skipped || []).length && !recovered) report.ok = false;
  }
  return report;
}

export function summarizeReport(report) {
  const c = report.checks;
  const lines = [];
  lines.push(`검수 결과: ${report.ok ? '통과' : '확인 필요'} (${report.format?.toUpperCase?.() ?? ''}${report.pages ? `, ${report.pages}쪽` : ''})`);
  const gen = report.mode === 'generate';
  if (c.values && !gen) lines.push(`- 값 반영: ${c.values.applied}건 적용${c.values.missing.length ? `, 누락 ${c.values.missing.length}건 → ${c.values.missing.map((m) => m.key).join(', ')}` : ', 누락 없음'}`);
  if (c.stale && !gen) lines.push(`- 이전 문서 값 잔존: ${c.stale.items.length ? c.stale.items.map((s) => `${s.key}(“${s.previous}”)`).join(', ') : '없음'}`);
  if (c.unfilled && !gen) lines.push(`- 미기입 칸: ${c.unfilled.count ? c.unfilled.items.slice(0, 12).map((u) => `${u.key}[${u.state}]`).join(', ') + (c.unfilled.count > 12 ? ` 외 ${c.unfilled.count - 12}건` : '') : '없음'}`);
  if (c.lint && !c.lint.error) lines.push(`- 공문서 표기법: ${c.lint.count ? `${c.lint.count}건 (${c.lint.items.slice(0, 5).map((i) => `${i.rule}:${i.match ?? ''}`).join(', ')})` : '문제 없음'}`);
  if (c.weekday) lines.push(`- 날짜·요일: ${c.weekday.items.length ? c.weekday.items.map((w) => `“${w.date}” ${w.problem}${w.hint ? ` (${w.hint})` : ''}`).join(', ') : '이상 없음'}`);
  if (c.privacy && !c.privacy.error) lines.push(`- 개인정보 탐지: ${c.privacy.count ? Object.entries(c.privacy.byRule).map(([k, v]) => `${k} ${v}건`).join(', ') + ' (공개 전 확인)' : '없음'}`);
  if (c.structure) lines.push(`- 파일 구조: ${c.structure.ok ? '정상' : '오류 ' + JSON.stringify(c.structure.issues || c.structure.error)}`);
  if (c.patch?.skipped?.length && !c.patch.recovered) lines.push(`- 서식 보존 패치 미적용: ${c.patch.skipped.length}건 → ${JSON.stringify(c.patch.skipped).slice(0, 300)}`);
  return lines.join('\n');
}
