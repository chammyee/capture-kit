// Build output/figma-import/: images, place_NN.js for Figma MCP use_figma, and files.txt.
// Coordinates are computed here, so Claude only passes the scripts along.
// Delete a screen folder before running this to leave that screen out.
// usage: npm run export -- [config.json]
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const CONFIG = path.resolve(process.argv[2] || 'config.json');
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const OUT = path.join(path.dirname(CONFIG), 'output');
const DEST = path.join(OUT, 'figma-import');
const TEMPLATE = fs.readFileSync(new URL('./place_template.js', import.meta.url), 'utf8');
const safe = (s) => String(s).replace(/[/\\:*?"<>|]/g, '-').trim();
const MAX_IMAGES = 200;
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

const WIDTH = cfg.device === 'desktop' ? 1440 : 390;
const GAP = 40, SITE_GAP = 200, ROW_GAP = 400, PAD = 200, GROUP_H = 100, HEAD_H = 90, LABEL_H = 60;

let n = 0;
const sites = [];
for (const site of cfg.sites) {
  const screens = [];
  for (const lang of cfg.languages) for (const sc of cfg.screens) {
    const dir = path.join(OUT, safe(site.name), lang, safe(sc.name));
    const chunkDir = path.join(dir, 'chunks');
    if (!fs.existsSync(chunkDir)) continue;
    const images = [];
    for (const f of fs.readdirSync(chunkDir).filter((x) => x.endsWith('.jpg')).sort()) {
      const file = `${String(++n).padStart(4, '0')}.jpg`;
      fs.copyFileSync(path.join(chunkDir, f), path.join(DEST, file));
      const { width: w, height: h } = await sharp(path.join(chunkDir, f)).metadata();
      images.push({ file, h: Math.round(h * WIDTH / w) });
    }
    screens.push({ name: sc.name, lang: lang.toUpperCase(), url: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).url, images });
  }
  if (screens.length) sites.push({ name: site.name, group: site.group || '기타', url: site.url, screens });
}

// One row per group, sites left to right.
const siteItems = new Map();
let y = PAD, maxX = 0;
for (const group of [...new Set(sites.map((s) => s.group))]) {
  const groupY = y;
  y += GROUP_H + GAP;
  let x = PAD, bottom = y, first = true;
  for (const site of sites.filter((s) => s.group === group)) {
    const items = [];
    if (first) { items.push(['T', group, PAD, groupY, 72]); first = false; }
    const count = site.screens.length;
    const siteW = Math.max(count * WIDTH + (count - 1) * GAP, 390);
    items.push(['H', site.name, x, y, siteW, HEAD_H, site.url]);
    let cx = x;
    for (const sc of site.screens) {
      let ry = LABEL_H;
      const rects = sc.images.map((im) => { const r = [im.file, ry, im.h]; ry += im.h; return r; });
      items.push(['S', `${site.name} / ${sc.name} / ${sc.lang}`, `${sc.name} / ${sc.lang}`, sc.url, cx, y + HEAD_H + GAP, WIDTH, ry, rects]);
      bottom = Math.max(bottom, y + HEAD_H + GAP + ry);
      cx += WIDTH + GAP;
    }
    siteItems.set(site, items);
    x += siteW + SITE_GAP;
    maxX = Math.max(maxX, x - SITE_GAP);
  }
  y = bottom + ROW_GAP;
}
const sectionW = maxX + PAD, sectionH = y - ROW_GAP + PAD;

// Split by site so each use_figma call stays small.
const batches = [];
let cur = [], curN = 0;
for (const site of sites) {
  const k = site.screens.reduce((a, s) => a + s.images.length, 0);
  if (curN && curN + k > MAX_IMAGES) { batches.push(cur); cur = []; curN = 0; }
  cur.push(...siteItems.get(site));
  curN += k;
}
if (cur.length) batches.push(cur);
batches.forEach((items, i) => {
  const data = { section: cfg.project || 'Capture', w: sectionW, h: sectionH, items };
  fs.writeFileSync(path.join(DEST, `place_${String(i + 1).padStart(2, '0')}.js`), TEMPLATE.replace('__DATA__', JSON.stringify(data)));
});
console.log(`사이트 ${sites.length}개, 이미지 ${n}개, 배치 스크립트 ${batches.length}개: ${DEST}`);
