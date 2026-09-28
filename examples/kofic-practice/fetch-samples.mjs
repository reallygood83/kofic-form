#!/usr/bin/env node
// 영화진흥위원회 누리집에 공개된 실습용 한글 문서를 내려받는다(저장소에는 원본을 싣지 않음).
//   node examples/kofic-practice/fetch-samples.mjs [저장폴더]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), 'samples'));
const SAMPLES = [
  {
    name: '입찰공고문(재공고)_VP연구용역.hwp',
    page: 'https://www.kofic.or.kr/kofic/business/board/selectBoardDetail.do?boardNumber=6&boardSeqNumber=74441',
    fileUrl: '/kofic/uploadFile/attachFile/202607',
    fileNm: '2b77edac7fcd40b3bf8b39fa4faf7507.hwp',
    dnFileName: '[입찰2026-10] 입찰공고문(재공고).hwp',
  },
  {
    name: '(양식1)_첨단제작지원_공통서류.hwp',
    page: 'https://www.kofic.or.kr/kofic/business/prom/findPromotionYearList.do',
    fileUrl: '/kofic/uploadFile/attachFile/202608',
    fileNm: '8bfcb814be3d4c248fba41b1cff3cd5a.hwp',
    dnFileName: '(양식1) 공통서류(2회차)_작품명_신청사명.hwp',
  },
  {
    name: '(양식2)_첨단제작지원_제작계획서.hwp',
    page: 'https://www.kofic.or.kr/kofic/business/prom/findPromotionYearList.do',
    fileUrl: '/kofic/uploadFile/attachFile/202608',
    fileNm: '4946fcda6d8f45e6a257207c6bba4a42.hwp',
    dnFileName: '(양식2) 제작계획서(2회차)_작품명_신청사명.hwp',
  },
];

mkdirSync(outDir, { recursive: true });
let ok = 0;
for (const s of SAMPLES) {
  try {
    const body = new URLSearchParams({ fileUrl: s.fileUrl, fileNm: s.fileNm, dnFileName: s.dnFileName });
    const r = await fetch('https://www.kofic.or.kr/kofic/business/comm/file/downloadFile.do', { method: 'POST', body });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || buf.subarray(0, 4).toString('hex') !== 'd0cf11e0') throw new Error(`HTTP ${r.status}, HWP 파일이 아님`);
    writeFileSync(join(outDir, s.name), buf);
    ok += 1;
    process.stdout.write(`✔ ${s.name} (${Math.round(buf.length / 1024)}KB)\n`);
  } catch (e) {
    process.stdout.write(`✘ ${s.name}: ${e.message}\n  게시물이 바뀌었을 수 있습니다. 직접 내려받기: ${s.page}\n`);
  }
}
process.stdout.write(`\n${ok}/${SAMPLES.length}개 저장: ${outDir}\n`);
