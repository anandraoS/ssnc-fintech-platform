// Verifies both generated PDFs: size, page count, required sections, footer on every page, page numbers, bookmarks,
// rendering artefacts, text overflow (text positioned outside the page), images, and PDF 2 question counts.
// Usage: node verify-pdfs.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DOCS, FOOTER_LINES } from './lib/common.mjs';

const PDF1 = path.join(DOCS, 'pdf', 'SSNC_FinTech_Platform_Architecture_and_Workflows.pdf');
const PDF2 = path.join(DOCS, 'pdf', 'SSNC_Senior_Lead_Java_Fullstack_Interview_Guide.pdf');
const PDF1_SECTIONS = [
  'Business problem and project objectives', 'Functional and non-functional requirements', 'System context diagram', 'Component architecture',
  'Angular frontend architecture', 'React frontend edition', 'Java and Spring Boot backend architecture', 'Database ER diagram', 'Customer and account lifecycle',
  'Transaction lifecycle and state machine', 'Account transfer sequence diagram', 'Idempotency and concurrency-control flow',
  'Authentication and authorization', 'REST API examples', 'Database transaction boundaries', 'Error-handling and recovery flows', 'CI/CD pipeline',
  'Cloud deployment architecture', 'Observability architecture', 'Security threat model', 'Test strategy', 'AI-assisted development workflow',
  'Architecture mind map', 'Troubleshooting scenarios', 'Architecture decisions and trade-offs', 'Known limitations and future enhancements',
  'Appendix A: Captured PostgreSQL query plans', 'Appendix B: Validation summary', 'Appendix C: Operations console screenshots', 'Appendix D: React console screenshots',
];
const PDF2_SECTIONS = [
  'How to use this handbook', 'Java, Spring Boot and Hibernate reference', 'System design and distributed systems reference', 'Databases reference',
  'Angular reference', 'DevOps, cloud and security reference', 'AI-assisted development reference', 'Technical leadership and agile delivery',
  'Job-description traceability matrix', 'Interview question bank',
];

let failures = 0;
const out = [];
const rec = (ok, msg) => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

async function analyse(file, label, sections, opts) {
  out.push(`\n== ${label}: ${path.basename(file)}`);
  if (!fs.existsSync(file)) { rec(false, 'file exists'); return null; }
  const buf = fs.readFileSync(file);
  rec(buf.length > 200000, `size ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const n = pdf.numPages;
  rec(n >= opts.minPages, `page count ${n} (minimum ${opts.minPages})`);
  const outline = await pdf.getOutline();
  rec(Array.isArray(outline) && outline.length >= opts.minBookmarks, `bookmarks present: ${outline ? outline.length : 0} top-level entries`);
  const texts = [];
  const fonts = new Set();
  let images = 0, landscape = 0;
  const overflow = [];
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    if (vp.width > vp.height) landscape++;
    const tc = await page.getTextContent();
    texts.push(tc.items.map((i) => i.str).join(' '));
    for (const it of tc.items) {
      const x = it.transform[4], y = it.transform[5];
      if (it.str.trim() && (x < -1 || x > vp.width + 1 || y < -1 || y > vp.height + 1)) { overflow.push(p); break; }
      if (it.fontName) fonts.add(it.fontName);
    }
    const ops = await page.getOperatorList();
    for (const fn of ops.fnArray) if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) images++;
  }
  const all = texts.join('\n');
  const flat = (s) => s.replace(/\s+/g, ' ');
  const allFlat = flat(all);
  for (const s of sections) rec(allFlat.includes(flat(s)), `section present: "${s}"`);
  const missing = [];
  for (let p = 1; p <= n; p++) if (!FOOTER_LINES.every((l) => flat(texts[p - 1]).includes(flat(l)))) missing.push(p);
  rec(missing.length === 0, `two-line Cotiviti footer on every page including the cover${missing.length ? ' (missing ' + missing.slice(0, 10).join(',') + ')' : ''}`);
  rec(texts.slice(1).every((t, i) => t.includes(`Page ${i + 2} of ${n}`)), 'page numbers "Page i of N" on every page after the cover');
  for (const bad of [/\bundefined undefined\b/, /\[object Object/, /missing image/i, /diagram [\w-]+ not available/i, /\{\{(code|diagram):/, /NaN%/, /diagram:\d\d/]) {
    const hit = texts.findIndex((t) => bad.test(t));
    rec(hit < 0, `no rendering artefact ${bad}${hit >= 0 ? ' (page ' + (hit + 1) + ')' : ''}`);
  }
  rec(overflow.length === 0, `no text positioned outside the page${overflow.length ? ' (pages ' + overflow.slice(0, 8).join(',') + ')' : ''}`);
  rec(images >= opts.minImages, `embedded images ${images} (minimum ${opts.minImages})`);
  const empty = texts.map((t, i) => [i + 1, t.replace(/Page \d+ of \d+/, '').trim().length]).filter(([, l]) => l < 300).map(([p]) => p);
  rec(empty.length <= opts.maxNearEmpty, `near-empty pages ${empty.length} (${empty.slice(0, 15).join(',')}); allowed ${opts.maxNearEmpty} (diagram pages carry little text)`);
  out.push(`INFO  fonts used: ${[...fonts].length}; landscape pages: ${landscape}`);
  const meta = await pdf.getMetadata();
  out.push(`INFO  title: ${meta.info?.Title}`);
  return { all, n, texts };
}

const r1 = await analyse(PDF1, 'PDF 1', PDF1_SECTIONS, { minPages: 100, minImages: 20, maxNearEmpty: 30, minBookmarks: 20 });
const r2 = await analyse(PDF2, 'PDF 2', PDF2_SECTIONS, { minPages: 60, minImages: 0, maxNearEmpty: 10, minBookmarks: 8 });
if (r1) {
  rec(/ADR-013/.test(r1.all), 'all 13 ADRs present (ADR-013 found)');
  rec(/automountServiceAccountToken|Kubernetes/.test(r1.all) && /Idempotency-Key/.test(r1.all), 'Kubernetes and Idempotency-Key content present');
}
if (r2) {
  const qs = new Set([...r2.all.matchAll(/\bQ(\d{1,3})\.\s/g)].map((m) => Number(m[1])));
  const missingQ = []; for (let i = 1; i <= 142; i++) if (!qs.has(i)) missingQ.push(i);
  rec(missingQ.length === 0, `question headings Q1..Q142 all present${missingQ.length ? ' (missing ' + missingQ.join(',') + ')' : ''}`);
  const scen = (r2.all.match(/\[Scenario\]/g) ?? []).length;
  rec(scen >= 45, `scenario-tagged questions: ${scen} (minimum 45)`);
}
console.log(out.join('\n'));
console.log(`\n${failures === 0 ? 'ALL PDF CHECKS PASSED' : failures + ' PDF CHECK(S) FAILED'}`);
process.exit(failures ? 1 : 0);
