// Run through Figma MCP use_figma. Set PAGE_ID first. Returns [image file, rectangle id] pairs for upload_assets.
const PAGE_ID = 'PAGE_ID_HERE';
const DATA = __DATA__;
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
const fonts = await figma.listAvailableFontsAsync();
const has = (family, style) => fonts.some((f) => f.fontName.family === family && f.fontName.style === style);
let bold = null;
for (const family of ['Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Inter']) {
  const style = ['Bold', 'SemiBold', 'Semi Bold'].find((s) => has(family, s));
  if (style) { bold = { family, style }; break; }
}
if (!bold) throw new Error('No usable font');
await figma.loadFontAsync(bold);
const text = (parent, value, size, color, url) => {
  const t = figma.createText();
  parent.appendChild(t);
  t.fontName = bold;
  t.fontSize = size;
  t.characters = value;
  t.fills = [{ type: 'SOLID', color }];
  if (url) t.hyperlink = { type: 'URL', value: url };
  return t;
};
const BLACK = { r: 0, g: 0, b: 0 }, WHITE = { r: 1, g: 1, b: 1 }, DARK = { r: 0.1, g: 0.1, b: 0.11 };
let section = page.children.find((n) => n.type === 'SECTION' && n.name === DATA.section);
if (!section) {
  section = figma.createSection();
  section.name = DATA.section;
  page.appendChild(section);
  section.x = page.children.filter((n) => n !== section).reduce((m, n) => Math.max(m, n.x + n.width), 0) + 400;
  section.y = 0;
}
section.resizeWithoutConstraints(DATA.w, DATA.h);
const out = [];
for (const it of DATA.items) {
  if (it[0] === 'T') {
    const t = text(section, it[1], it[4], BLACK);
    t.x = it[2]; t.y = it[3];
  } else if (it[0] === 'H') {
    const f = figma.createFrame();
    section.appendChild(f);
    f.name = `${it[1]} / Header`;
    f.resize(it[4], it[5]);
    f.x = it[2]; f.y = it[3];
    f.fills = [{ type: 'SOLID', color: DARK }];
    const t = text(f, it[1], 32, WHITE, it[6]);
    t.x = 24; t.y = (it[5] - t.height) / 2;
  } else {
    const f = figma.createFrame();
    section.appendChild(f);
    f.name = it[1];
    f.resize(it[6], it[7]);
    f.x = it[4]; f.y = it[5];
    f.fills = [];
    text(f, it[2], 28, BLACK, it[3]);
    for (const [file, y, h] of it[8]) {
      const r = figma.createRectangle();
      f.appendChild(r);
      r.name = `${it[1]} ${file}`;
      r.resize(it[6], h);
      r.y = y;
      out.push([file, r.id]);
    }
  }
}
return out;
