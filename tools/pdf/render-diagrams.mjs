// Renders docs/diagrams/*.mmd to docs/diagrams/rendered/*.png with mermaid-cli (installed under .work/tools/mermaid).
// Usage: node tools/pdf/render-diagrams.mjs [--only 06]    (set BROWSER_BIN to override the Chromium/Edge used)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, DOCS } from './lib/common.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const isWin = process.platform === 'win32';
const mmdc = path.join(ROOT, '.work', 'tools', 'mermaid', 'node_modules', '.bin', isWin ? 'mmdc.cmd' : 'mmdc');
const cfg = path.join(DOCS, 'diagrams', 'puppeteer-config.json');
const out = path.join(DOCS, 'diagrams', 'rendered');
fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(mmdc)) throw new Error(`mermaid-cli not found at ${mmdc}`);

const files = fs.readdirSync(path.join(DOCS, 'diagrams')).filter((f) => f.endsWith('.mmd') && (!only || f.startsWith(only))).sort();
let failed = 0;
for (const f of files) {
  const png = path.join(out, f.replace(/\.mmd$/, '.png'));
  try {
    execFileSync(mmdc, ['-p', cfg, '-i', path.join(DOCS, 'diagrams', f), '-o', png, '-e', 'png', '-b', 'white', '-s', '2', '-q'],
      { stdio: 'pipe', shell: true, timeout: 180000 });
    console.log(`rendered ${f} (${Math.round(fs.statSync(png).size / 1024)} KB)`);
  } catch (e) {
    failed++;
    console.log(`FAILED   ${f}: ${String(e.stderr ?? e.message).split('\n').slice(0, 4).join(' | ')}`);
  }
}
console.log(`${files.length - failed}/${files.length} diagrams rendered`);
process.exit(failed ? 1 : 0);
