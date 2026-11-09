// Self-check without Figma: builds a sample export layout and runs place_template.js against a fake figma object.
// usage: npm run check
import assert from 'node:assert';
import fs from 'node:fs';
import { allowed } from './upload.mjs';
import { parseRobots, robotsAllows } from './robots.mjs';

assert(allowed('https://mcp.figma.com/mcp/upload/abc/submit'));
assert(!allowed('https://example.com/mcp/upload/abc'));
assert(!allowed('http://mcp.figma.com/x'));

const rules = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*?q=');
assert(robotsAllows(rules, '/shop'));
assert(!robotsAllows(rules, '/private/x'));
assert(robotsAllows(rules, '/private/open/x'));
assert(!robotsAllows(rules, '/s?q=1'));
assert(robotsAllows(parseRobots(''), '/any'));

let id = 0;
const node = (type) => ({ type, id: `1:${++id}`, x: 0, y: 0, width: 100, height: 40, children: [], name: '',
  appendChild(c) { this.children.push(c); }, resize(w, h) { this.width = w; this.height = h; }, resizeWithoutConstraints(w, h) { this.width = w; this.height = h; } });
const page = node('PAGE');
const old = node('FRAME'); old.x = 100; old.width = 500; page.appendChild(old);
const figma = { getNodeByIdAsync: async () => page, setCurrentPageAsync: async () => {},
  listAvailableFontsAsync: async () => [{ fontName: { family: 'Inter', style: 'Bold' } }], loadFontAsync: async () => {},
  createText: () => node('TEXT'), createFrame: () => node('FRAME'), createRectangle: () => node('RECTANGLE'), createSection: () => node('SECTION') };
const data = { section: 'P', w: 2000, h: 3000, items: [['T', 'G', 200, 200, 72], ['H', 'A', 200, 340, 820, 90, 'https://a.test'],
  ['S', 'A / 홈 / KO', '홈 / KO', 'https://a.test', 200, 470, 390, 2108, [['0001.jpg', 60, 2048]]],
  ['S', 'A / 상세 / KO', '상세 / KO', 'https://a.test/d', 630, 470, 390, 860, [['0002.jpg', 60, 800]]]] };
const src = fs.readFileSync(new URL('./place_template.js', import.meta.url), 'utf8').replace('__DATA__', JSON.stringify(data));
const AsyncFunction = (async () => {}).constructor;
const run = () => new AsyncFunction('figma', src)(figma);
const a = await run();
assert.deepEqual(a.map((x) => x[0]), ['0001.jpg', '0002.jpg']);
const section = page.children.find((n) => n.type === 'SECTION');
assert.equal(section.x, 1000);
assert.equal(section.children.length, 4);
await run();
assert.equal(page.children.filter((n) => n.type === 'SECTION').length, 1, 'second batch must reuse the section');
console.log('check ok');
