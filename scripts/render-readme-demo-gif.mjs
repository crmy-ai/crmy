import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const width = 900;
const height = 506;
const fps = 10;
const seconds = 11.6;
const frameCount = Math.round(fps * seconds);
const delayCs = Math.round(100 / fps);
const outFile = path.resolve('examples/crmy-governed-agent-context-demo.gif');

const palette = buildPalette();

function hexToRgb(hex) {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function buildPalette() {
  const colors = [
    '#020617', '#0f172a', '#111827', '#1e293b', '#334155', '#475569',
    '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9', '#f8fafc',
    '#ffffff', '#000000', '#052e16', '#064e3b', '#047857', '#059669',
    '#10b981', '#34d399', '#bbf7d0', '#dcfce7', '#082f49', '#075985',
    '#0369a1', '#0284c7', '#38bdf8', '#bae6fd', '#1e1b4b', '#3730a3',
    '#4f46e5', '#6366f1', '#a5b4fc', '#e0e7ff', '#422006', '#92400e',
    '#d97706', '#f59e0b', '#fde68a', '#fef3c7', '#450a0a', '#991b1b',
    '#dc2626', '#f87171', '#fecaca', '#3b0764', '#7e22ce', '#a855f7',
    '#ddd6fe', '#ecfeff', '#cffafe', '#67e8f9', '#0891b2',
  ].map(hexToRgb);

  const grays = [];
  for (let i = 0; i <= 255; i += 7) grays.push([i, i, i]);
  const all = [...colors, ...grays];
  while (all.length < 256) all.push([248, 250, 252]);
  return all.slice(0, 256);
}

function nearestPaletteIndex(r, g, b, cache) {
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const [pr, pg, pb] = palette[i];
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
      if (dist === 0) break;
    }
  }
  cache.set(key, best);
  return best;
}

function rgbaToIndexed(rgba) {
  const indexed = new Uint8Array(width * height);
  const cache = new Map();
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    indexed[p] = nearestPaletteIndex(rgba[i], rgba[i + 1], rgba[i + 2], cache);
  }
  return indexed;
}

class ByteWriter {
  constructor() {
    this.parts = [];
  }
  byte(value) {
    this.parts.push(Buffer.from([value & 255]));
  }
  bytes(values) {
    this.parts.push(Buffer.from(values));
  }
  string(value) {
    this.parts.push(Buffer.from(value, 'ascii'));
  }
  u16(value) {
    this.byte(value & 255);
    this.byte((value >> 8) & 255);
  }
  buffer() {
    return Buffer.concat(this.parts);
  }
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.current = 0;
    this.bits = 0;
  }
  write(code, size) {
    this.current |= code << this.bits;
    this.bits += size;
    while (this.bits >= 8) {
      this.bytes.push(this.current & 255);
      this.current >>= 8;
      this.bits -= 8;
    }
  }
  finish() {
    if (this.bits > 0) this.bytes.push(this.current & 255);
    return Uint8Array.from(this.bytes);
  }
}

function lzwEncode(indices) {
  const minCodeSize = 8;
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let next = end + 1;
  let codeSize = minCodeSize + 1;
  const bits = new BitWriter();

  function resetDictionary() {
    next = end + 1;
    codeSize = minCodeSize + 1;
    const dict = new Map();
    for (let i = 0; i < clear; i += 1) dict.set(String(i), i);
    return dict;
  }

  let dict = resetDictionary();
  bits.write(clear, codeSize);
  let prefix = String(indices[0]);

  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i];
    const joined = `${prefix},${k}`;
    if (dict.has(joined)) {
      prefix = joined;
      continue;
    }
    bits.write(dict.get(prefix), codeSize);
    if (next >= 510) {
      bits.write(clear, codeSize);
      dict = resetDictionary();
    } else {
      dict.set(joined, next);
      next += 1;
      if (next === (1 << codeSize) && codeSize < 12) codeSize += 1;
    }
    prefix = String(k);
  }

  bits.write(dict.get(prefix), codeSize);
  bits.write(end, codeSize);
  return bits.finish();
}

function writeSubBlocks(writer, data) {
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    writer.byte(chunk.length);
    writer.bytes(chunk);
  }
  writer.byte(0);
}

function makeGif(frames) {
  const w = new ByteWriter();
  w.string('GIF89a');
  w.u16(width);
  w.u16(height);
  w.byte(0xf7);
  w.byte(0);
  w.byte(0);
  for (const [r, g, b] of palette) w.bytes([r, g, b]);
  w.bytes([0x21, 0xff, 0x0b]);
  w.string('NETSCAPE2.0');
  w.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);

  for (const frame of frames) {
    w.bytes([0x21, 0xf9, 0x04, 0x04]);
    w.u16(delayCs);
    w.byte(0);
    w.byte(0);
    w.byte(0x2c);
    w.u16(0);
    w.u16(0);
    w.u16(width);
    w.u16(height);
    w.byte(0);
    w.byte(8);
    writeSubBlocks(w, lzwEncode(frame));
  }
  w.byte(0x3b);
  return w.buffer();
}

function pageHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #0b0f14; }
  canvas { width: ${width}px; height: ${height}px; display: block; }
</style>
</head>
<body>
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const W = ${width};
const H = ${height};
const total = ${frameCount};

const lines = [
  { kind: 'cmd', text: '$ crmy briefing "account:Northstar Labs"' },
  { kind: 'dim', text: '' },
  { kind: 'ok', text: '✓ Resolved account "Northstar Labs" (d0000000)' },
  { kind: 'ok', text: '✓ Briefing returned 4 Memory items, 3 activities, and 2 reviewable Signal sets' },
  { kind: 'title', text: 'Memory' },
  { kind: 'out', text: '- Security review is the active expansion blocker' },
  { kind: 'out', text: '- Maya is the current expansion champion' },
  { kind: 'title', text: 'Signals needing review' },
  { kind: 'warn', text: '- Procurement is not involved yet · grounded, not confirmed as Memory' },
  { kind: 'dim', text: '' },
  { kind: 'cmd', text: '$ crmy action-context "account:Northstar Labs" --action customer_outreach' },
  { kind: 'dim', text: '' },
  { kind: 'ok', text: '✓ Action Context returned warn mode, review_needed readiness' },
  { kind: 'title', text: 'Safe to act?' },
  { kind: 'out', text: '- Customer outreach is allowed' },
  { kind: 'out', text: '- Include technical validation as the next step' },
  { kind: 'warn', text: '- Keep the procurement claim out of committed CRM updates until confirmed' },
  { kind: 'dim', text: '' },
  { kind: 'cmd', text: '$ crmy context lineage --subject "account:Northstar Labs"' },
  { kind: 'dim', text: '' },
  { kind: 'ok', text: '✓ Lineage returned 74 nodes, 459 edges, 0 pending outcomes' },
  { kind: 'out', text: 'Sources → Signals → Memory → Action Context → audit receipts' },
  { kind: 'dim', text: '' },
  { kind: 'cmd', text: '$ claude mcp add crmy -- crmy mcp' },
];

function clamp(n, min = 0, max = 1) { return Math.max(min, Math.min(max, n)); }
function ease(x) { x = clamp(x); return x * x * (3 - 2 * x); }

function roundRect(x, y, w, h, r, fill, stroke, line = 1) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.stroke(); }
}

function text(value, x, y, size, color = '#e2e8f0', weight = 500, font = 'ui-monospace') {
  ctx.fillStyle = color;
  ctx.font = weight + ' ' + size + 'px ' + font + ', SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(value, x, y);
}

function pill(label, x, y, fill, color) {
  ctx.font = '700 11px Inter, ui-sans-serif, system-ui';
  const w = ctx.measureText(label).width + 22;
  roundRect(x, y, w, 25, 12, fill, null);
  ctx.fillStyle = color;
  ctx.font = '700 11px Inter, ui-sans-serif, system-ui';
  ctx.fillText(label, x + 11, y + 7);
  return w;
}

function colorFor(kind) {
  if (kind === 'cmd') return '#67e8f9';
  if (kind === 'cmd2') return '#38bdf8';
  if (kind === 'ok') return '#34d399';
  if (kind === 'warn') return '#fbbf24';
  if (kind === 'title') return '#f8fafc';
  if (kind === 'out') return '#cbd5e1';
  if (kind === 'run') return '#a5b4fc';
  if (kind === 'rule' || kind === 'dim') return '#64748b';
  return '#cbd5e1';
}

function drawTerminal(t) {
  const reveal = Math.floor(ease(t) * (lines.length + 4));
  const cursorLine = Math.min(lines.length - 1, Math.max(0, reveal));
  const lineHeight = 18;
  const top = 40;
  const visibleRows = 23;
  const start = Math.max(0, cursorLine - visibleRows + 1);
  const end = Math.min(lines.length, reveal + 1);

  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  roundRect(26, 22, 848, 462, 12, '#10151d', '#29313b', 1);
  ctx.shadowColor = 'transparent';
  roundRect(26, 22, 848, 34, 12, '#171d26', null);
  roundRect(26, 44, 848, 13, 0, '#171d26', null);

  ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(52, 39, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(70, 39, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#10b981'; ctx.beginPath(); ctx.arc(88, 39, 5.5, 0, Math.PI * 2); ctx.fill();
  text('crmy production-style demo', 116, 31, 12, '#94a3b8', 700, 'Inter, ui-sans-serif');

  let y = top + 36;
  for (let i = start; i < end; i += 1) {
    const line = lines[i];
    const prefix = line.kind === 'ok' || line.kind === 'warn' ? '' : '  ';
    const maxText = (prefix + line.text).slice(0, 105);
    text(maxText, 58, y, line.kind === 'title' ? 13 : 12, colorFor(line.kind), line.kind === 'title' ? 800 : 650);
    y += line.kind === 'dim' ? 10 : lineHeight;
  }

  if (reveal < lines.length + 2 && Math.floor(t * 12) % 2 === 0) {
    roundRect(58 + 7 * Math.min(90, (lines[cursorLine]?.text ?? '').length), y - lineHeight + 2, 8, 14, 1, '#cbd5e1');
  }
}

function drawFrame(i) {
  const t = i / (total - 1);
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, W, H);

  drawTerminal(t);
}

window.renderFrame = (i) => {
  drawFrame(i);
  return Array.from(ctx.getImageData(0, 0, W, H).data);
};
</script>
</body>
</html>`;
}

async function main() {
  await mkdir(path.dirname(outFile), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(pageHtml(), { waitUntil: 'load' });

  if (process.env.CRMY_DEMO_PREVIEW === '1') {
    await page.evaluate((frame) => window.renderFrame(frame), Math.floor(frameCount * 0.78));
    await page.screenshot({ path: '/tmp/crmy-demo-render-preview.png' });
    await browser.close();
    console.log('Wrote /tmp/crmy-demo-render-preview.png');
    return;
  }

  const frames = [];
  for (let i = 0; i < frameCount; i += 1) {
    const rgba = await page.evaluate((frame) => window.renderFrame(frame), i);
    frames.push(rgbaToIndexed(Uint8Array.from(rgba)));
    if ((i + 1) % 10 === 0) console.log(`Rendered ${i + 1}/${frameCount} frames`);
  }
  await browser.close();

  const gif = makeGif(frames);
  await writeFile(outFile, gif);
  console.log(`Wrote ${outFile} (${Math.round(gif.length / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
