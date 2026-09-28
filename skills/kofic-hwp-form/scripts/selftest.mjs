#!/usr/bin/env node
// 자체 시험: 가상 신청서(HWPX·HWP)와 내장 기안문으로 학습→채우기→검수 전 과정을 확인한다.
// 사용자 양식함을 건드리지 않도록 임시 폴더(HWPFORM_HOME)에서 실행한다.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, 'hwpform.mjs');
const work = mkdtempSync(join(tmpdir(), 'hwpform-selftest-'));
const env = { ...process.env, HWPFORM_HOME: join(work, 'library') };
let pass = 0;
let fail = 0;

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { env, encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* not json */
  }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    process.stdout.write(`  ✔ ${name}\n`);
  } else {
    fail += 1;
    process.stdout.write(`  ✘ ${name} ${detail}\n`);
  }
}

async function main() {
  process.stdout.write(`kofic-hwp-form 자체 시험 (임시 폴더: ${work})\n`);
  const { loadKordoc } = await import('./lib/runtime.mjs');
  const k = await loadKordoc();

  // 1) 가상 신청서 HWPX 만들기
  const md = [
    '# 교육 참가 신청서',
    '',
    '1. 신청인 정보',
    '',
    '| 성명 |  | 소속 |  |',
    '| --- | --- | --- | --- |',
    '| 연락처 | 000-0000-0000 | 이메일 | @ |',
    '| 참가구분 (택1) | □ 대면 □ 온라인 | 직위 |  |',
    '',
    '2. 교육 정보',
    '',
    '| 교육명 | 한글 양식 자동화 실습 |',
    '| --- | --- |',
    '| 희망일 | YYYY년 MM월 DD일 |',
    '',
  ].join('\n');
  const formHwpx = join(work, '교육참가신청서.hwpx');
  writeFileSync(formHwpx, Buffer.from(await k.markdownToHwpx(md)));

  process.stdout.write('\n[1] HWPX 신청서 학습·채우기\n');
  const l1 = run(['learn', formHwpx, '--name', '교육 참가 신청서', '--id', 'test-form']);
  const keys = l1.json?.card?.slots?.map((s) => s.key) || [];
  check('양식 학습 성공', l1.json?.ok === true, l1.stderr);
  check('입력 칸 탐지(성명·소속·연락처·이메일·희망일)', ['성명', '소속', '연락처', '이메일', '희망일'].every((x) => keys.includes(x)), JSON.stringify(keys));
  check('선택 칸 탐지(참가구분)', l1.json?.card?.slots?.some((s) => s.kind === 'choice' && /참가구분/.test(s.key)));
  check('유형=신청서·서식', l1.json?.card?.docType?.type === 'form', l1.json?.card?.docType?.type);

  const values = { 성명: '홍길동', 소속: '영화진흥위원회 인사총무팀', 연락처: '051-720-0000', 이메일: 'hong@example.go.kr', '참가구분 (택1)': '온라인', 희망일: '2026년 10월 15일', 직위: '주무관' };
  const vfile = join(work, 'values.json');
  writeFileSync(vfile, JSON.stringify({ values }, null, 2));
  const outHwpx = join(work, 'out', '신청서_홍길동.hwpx');
  const f1 = run(['fill', 'test-form', '--values', vfile, '--out', outHwpx]);
  check('채우기 성공(검수 통과)', f1.json?.ok === true, JSON.stringify(f1.json?.report?.checks?.values || f1.json || f1.stderr).slice(0, 300));
  const p1 = await k.parse(readFileSync(outHwpx));
  const txt = p1.markdown.replace(/\s+/g, '');
  check('값이 문서에 들어감', ['홍길동', '영화진흥위원회인사총무팀', '051-720-0000', 'hong@example.go.kr', '2026년10월15일'].every((v) => txt.includes(v)));
  check('체크박스 ■ 표시(온라인)', /■\s*온라인/.test(p1.markdown) && /□\s*대면/.test(p1.markdown));

  process.stdout.write('\n[2] HWP 변환본으로 학습·채우기 (HWP 유지)\n');
  const hwpPath = join(work, '교육참가신청서.hwp');
  const cv = run(['convert', formHwpx, '--to', 'hwp', '--out', hwpPath]);
  check('HWPX→HWP 변환', cv.json?.ok === true, cv.stderr);
  const l2 = run(['learn', hwpPath, '--name', '교육 참가 신청서(HWP)', '--id', 'test-form-hwp']);
  check('HWP 양식 학습', l2.json?.ok === true && l2.json.card.source.format === 'hwp', l2.stderr);
  const outHwp = join(work, 'out', '신청서_홍길동.hwp');
  const f2 = run(['fill', 'test-form-hwp', '--values', vfile, '--out', outHwp]);
  check('HWP 채우기 성공', f2.json?.ok === true, JSON.stringify(f2.json?.report?.checks || f2.stderr).slice(0, 300));
  const p2 = await k.parse(readFileSync(outHwp));
  check('HWP 결과에 값 반영', p2.markdown.replace(/\s+/g, '').includes('홍길동'));

  process.stdout.write('\n[3] 내장 기안문(누름틀)\n');
  const b = run(['builtin', 'gian', '--org', '테스트기관']);
  check('기안문 등록(누름틀 23개)', b.json?.card?.fields?.length === 23, JSON.stringify(b.json).slice(0, 200));
  const gv = join(work, 'gian.json');
  writeFileSync(gv, JSON.stringify({ values: { 행정기관명: '테스트기관', 제목: '자체 시험 협조 요청', 본문: '1. 자체 시험입니다.\n2. 협조하여 주시기 바랍니다.', 시행일: '2026. 9. 28.' } }));
  const f3 = run(['fill', 'gian', '--values', gv, '--out', join(work, 'out', '기안문.hwpx')]);
  check('기안문 채우기 성공', f3.json?.ok === true, JSON.stringify(f3.json).slice(0, 300));

  process.stdout.write('\n[4] 오류 방지 장치\n');
  const bad = run(['fill', 'test-form', '--set', '없는칸=값']);
  check('없는 키는 파일을 만들지 않고 거부', bad.json?.ok === false && bad.code !== 0);
  const { checkWeekdays } = await import('./lib/verify.mjs');
  check('날짜-요일 불일치 탐지', checkWeekdays('마감 2025. 8. 10.(월)').length === 1);

  process.stdout.write(`\n결과: ${pass}개 통과, ${fail}개 실패\n`);
  if (!process.argv.includes('--keep')) rmSync(work, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  process.stdout.write(`자체 시험 오류: ${e.stack || e.message}\n`);
  process.exit(1);
});
