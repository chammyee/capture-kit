// Capture screens with the local Chrome. No LLM or MCP calls.
// usage: npm run capture -- [config.json] [--only "사이트명"]
// output (next to the config): output/<site>/<lang>/<screen>/{chunks/*.jpg, first.jpg, meta.json}, output/report.csv, output/review.jpg
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { parseRobots, robotsAllows } from './robots.mjs';

const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const ONLY = onlyAt >= 0 ? args.splice(onlyAt, 2)[1] : null;
const CONFIG = path.resolve(args[0] || 'config.json');
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const OUT = path.join(path.dirname(CONFIG), 'output');
fs.mkdirSync(OUT, { recursive: true });

const DEVICES = {
  mobile: { viewport: { width: 390, height: 848 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1' },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const DEVICE = DEVICES[cfg.device || 'mobile'];
if (!DEVICE) throw new Error(`device는 mobile 또는 desktop이어야 합니다: ${cfg.device}`);
const { width: VW, height: VH } = DEVICE.viewport;
const DPR = DEVICE.deviceScaleFactor;
const OVERLAP = 0.3, MAX_SHOTS = cfg.maxShots || 20, MAX_CHUNK = 4096;
const PRICE_RE = /(₩|\$|€|£|¥|KRW|USD|EUR|GBP|CHF)\s?\d[\d,.]*|\d[\d,.]{2,}\s?(원|€|KRW|USD|EUR)/;
const BLOCK_RE = /(access denied|security verification|verify you are human|are you a robot|unusual traffic|request blocked|captcha|접근이 차단|비정상적인 접근|보안 확인|사람인지 확인|have been blocked|page unavailable|quick verification|page can ?not be found)/i;

const safe = (s) => String(s).replace(/[/\\:*?"<>|]/g, '-').trim();
const REPORT = path.join(OUT, 'report.csv');
if (!fs.existsSync(REPORT)) fs.writeFileSync(REPORT, 'time,site,lang,screen,status,note\n');
const log = (site, lang, screen, status, note = '') => {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  fs.appendFileSync(REPORT, [new Date().toISOString(), site, lang, screen, status, note].map(q).join(',') + '\n');
  console.log(`[${site}/${lang}/${screen}] ${status} ${note}`);
};

// ---------- page helpers ----------
async function settle(page, ms = 2500) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(ms);
}

// Close popups with the decline option first, then hide what is left. Consent is never accepted.
async function dismiss(page) {
  for (let i = 0; i < 3; i++) {
    const clicked = await page.evaluate(() => {
      const RE = /^(reject|decline|reject all|refuse|necessary only|only necessary|필수.*(허용|만)|거부|모두 거부|닫기|close|×|✕|x|오늘 하루.*|다시 보지 않기|하루 동안 보지 않기|no thanks|not now|continue without accepting|only essential|essential only|use necessary cookies only)$/i;
      const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const pref = document.querySelector('#onetrust-reject-all-handler, .ot-pc-refuse-all-handler, [data-testid*=reject i], #didomi-notice-disagree-button');
      if (pref && vis(pref)) { pref.click(); return 1; }
      for (const e of document.querySelectorAll('button, a, [role=button], span, div')) {
        const t = (e.innerText || e.getAttribute('aria-label') || '').trim();
        if (t.length >= 30 || !RE.test(t) || !vis(e)) continue;
        for (let p = e; p && p !== document.body; p = p.parentElement) {
          const pos = getComputedStyle(p).position;
          if (pos === 'fixed' || pos === 'sticky' || p.getAttribute('role') === 'dialog' || p.getAttribute('aria-modal') === 'true') { e.click(); return 1; }
        }
      }
      return 0;
    }).catch(() => 0);
    if (!clicked) break;
    await page.waitForTimeout(800);
  }
  await page.evaluate(() => {
    const A = innerWidth * innerHeight;
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      if (s.position === 'fixed' || (s.position === 'absolute' && +s.zIndex > 999)) {
        const r = e.getBoundingClientRect();
        if (r.width * r.height > A * 0.25 && r.top < innerHeight && !e.matches('header, nav, [class*=header i]')) e.style.setProperty('display', 'none', 'important');
      }
    }
    for (const h of document.querySelectorAll('*')) {
      if (!h.shadowRoot || !/(privacy settings|cookie|consent|쿠키)/i.test(h.shadowRoot.textContent || '')) continue;
      const b = [...h.shadowRoot.querySelectorAll('button')].find((x) => /^(only essential|deny|reject all|decline|essential only)$/i.test((x.innerText || '').trim()));
      if (b) b.click();
      h.style.setProperty('display', 'none', 'important');
    }
    for (const e of document.querySelectorAll('body *')) {
      if (getComputedStyle(e).position === 'fixed' && /(privacy settings|cookie|쿠키)/i.test((e.innerText || '').slice(0, 300)) && e.getBoundingClientRect().height < innerHeight * 0.6) e.style.setProperty('display', 'none', 'important');
    }
    for (const el of [document.documentElement, document.body]) el.style.setProperty('overflow', 'auto', 'important');
  }).catch(() => {});
}

const isBlocked = async (page, resp) => (resp && [403, 429].includes(resp.status()))
  || BLOCK_RE.test(await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 600) : '')).catch(() => ''));

const goto = async (page, url) => {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page, 3000);
  return resp;
};

// ---------- terms check (keyword based, not a legal judgement) ----------
const TERMS_LINK = /(terms|conditions|legal|이용약관|약관)/i;
const TERMS_BAD = /(sale|purchase|privacy|cookie|개인정보|여행약관|위치정보|refund|shipping|return|gift|booking|reward|announce|공지)/i;
const TERMS_KW = /(robot|spider|scrap|crawl|data[- ]mining|automated (means|device|system|process|tool|software)|automatic (means|device)|로봇|크롤|스크래|매크로|자동화(된)? ?(수단|프로그램)|기계적(인)? ?(방법|수단))/gi;
const TERMS_NEG = /(not|prohibit|forbid|may not|must not|shall not|without (our|the) (prior )?(written )?(consent|permission)|금지|안 ?됩니다|아니|않|불가)/i;

async function termsCheck(page) {
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 3000).catch(() => {}); await page.waitForTimeout(400); }
  const host = new URL(page.url()).hostname.split('.').slice(-2).join('.');
  const links = (await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => [(a.innerText || '').trim().slice(0, 60), a.href])))
    .filter(([t, h]) => TERMS_LINK.test(`${t} ${h}`) && !TERMS_BAD.test(`${t} ${h}`) && /^https?:/.test(h) && new URL(h).hostname.endsWith(host)).slice(0, 3);
  if (!links.length) return { status: 'unknown', note: '약관 링크를 찾지 못해 건너뜀. 직접 확인 후 terms를 ok로 지정' };
  for (const [, h] of links) {
    await page.goto(h, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const t = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ');
    for (const m of t.matchAll(TERMS_KW)) {
      const c = t.slice(Math.max(0, m.index - 200), m.index + 150);
      if (TERMS_NEG.test(c)) return { status: 'ban', note: `${m[0]} @ ${h} :: ${c.slice(0, 200)}` };
    }
  }
  return { status: 'ok', note: `자동화 금지 문구 없음: ${links.map((l) => l[1]).join(' ')}` };
}

// ---------- robots.txt ----------
const robotsCache = new Map();
async function robotsOk(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules = [];
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) rules = parseRobots(await r.text());
    } catch { /* unreachable robots.txt: treated as no rules */ }
    robotsCache.set(u.origin, rules);
  }
  return robotsAllows(robotsCache.get(u.origin), u.pathname + u.search);
}

// ---------- capture ----------
const pickScroller = (page) => page.evaluate(() => {
  let best = document.scrollingElement || document.documentElement;
  if (best.scrollHeight <= innerHeight + 50) {
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      if (/(auto|scroll)/.test(s.overflowY) && e.clientHeight > 400 && e.scrollHeight > e.clientHeight + 100 && (best === (document.scrollingElement || document.documentElement) || e.scrollHeight > best.scrollHeight)) best = e;
    }
  }
  window.__ckS = best;
  const r = best === document.scrollingElement ? { top: 0, height: innerHeight } : best.getBoundingClientRect();
  return { H: best.scrollHeight, viewH: Math.round(r.height), top: Math.round(r.top) };
});

async function warmScroll(page) {
  const { H, viewH } = await pickScroller(page);
  for (let y = 0; y < Math.min(H, 20000); y += viewH) {
    await page.evaluate((v) => { window.__ckS.scrollTop = v; }, y);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => { window.__ckS.scrollTop = 0; });
  await page.waitForTimeout(800);
}

// Fixed top bars stay only in the first shot, fixed bottom bars only in the last, as in a manual scroll capture.
const toggleFixed = (page, hideTop, hideBottom) => page.evaluate(([ht, hb]) => {
  const inFixed = (e) => { for (let a = e, i = 0; a && a !== document.body && i < 8; a = a.parentElement, i++) { const q = getComputedStyle(a).position; if (q === 'fixed' || q === 'sticky') return true; } return false; };
  for (const e of document.querySelectorAll('body *')) {
    const p = getComputedStyle(e).position;
    const r = e.getBoundingClientRect();
    const own = p === 'fixed' || p === 'sticky';
    const floating = !own && (p === 'absolute' || p === 'relative') && r.width > 0 && r.width < 150 && r.height > 0 && r.height < 150 && inFixed(e.parentElement);
    if (!own && !floating) continue;
    const hide = r.height <= innerHeight * 0.5 && ((own && r.top < innerHeight / 2 && ht) || ((!own || r.top >= innerHeight / 2) && hb));
    if (hide) e.style.setProperty('visibility', 'hidden', 'important'); else e.style.removeProperty('visibility');
  }
}, [hideTop, hideBottom]);

async function captureScreen(page, dir) {
  const { H, viewH, top } = await pickScroller(page);
  const step = Math.round(viewH * (1 - OVERLAP));
  const ys = [0];
  for (let y = step; y < H - viewH && ys.length < MAX_SHOTS; y += step) ys.push(y);
  const end = Math.max(0, H - viewH);
  const truncated = ys.length >= MAX_SHOTS && ys[ys.length - 1] < end;
  if (!truncated && end > ys[ys.length - 1]) ys.push(end);
  const shots = [];
  for (const [i, y] of ys.entries()) {
    await page.evaluate((v) => { window.__ckS.scrollTop = v; }, y);
    await page.waitForTimeout(600);
    await toggleFixed(page, i > 0, i < ys.length - 1);
    shots.push(await page.screenshot());
  }
  await page.evaluate(() => { window.__ckS.scrollTop = 0; });
  await toggleFixed(page, false, false);
  await stitch(shots, ys, top, viewH, dir);
  return { H, shots: ys.length, truncated };
}

// Rows at the top or bottom that stay identical between neighbouring shots belong to a fixed bar.
// Capped so the two bands together stay below the 30% overlap and no content is lost.
const MAX_BAND = 0.14;
function bandRows(a, b, W, H, fromTop) {
  const limit = Math.floor(H * MAX_BAND);
  for (let n = 0; n < limit; n++) {
    const r = (fromTop ? n : H - 1 - n) * W;
    let diff = 0, count = 0;
    for (let x = 0; x < W; x += 3) { diff += Math.abs(a[r + x] - b[r + x]); count++; }
    if (diff / count > 1.5) return n;
  }
  return limit;
}

// Shots are pasted at their known scroll positions, so no feature matching is needed.
async function stitch(shots, ys, top, viewH, dir) {
  const W = VW * DPR;
  const last = ys[ys.length - 1];
  const totalH = Math.max(VH, top + last + viewH) * DPR;
  const regionH = Math.min(viewH, VH - top) * DPR;
  const region = (buf) => sharp(buf).extract({ left: 0, top: top * DPR, width: W, height: regionH });
  const grey = await Promise.all(shots.map((buf) => region(buf).greyscale().raw().toBuffer()));
  const band = (i, fromTop) => Math.max(...[i - 1, i + 1].filter((j) => grey[j]).map((j) => bandRows(grey[i], grey[j], W, regionH, fromTop)), 0);
  const layers = [];
  for (const [i, buf] of shots.entries()) {
    if (shots.length === 1) { layers.push({ input: buf, left: 0, top: 0 }); continue; }
    const cutTop = i > 0 ? band(i, true) : 0;
    const cutBottom = i < shots.length - 1 ? band(i, false) : 0;
    if (i === 0 && top > 0) layers.push({ input: await sharp(buf).extract({ left: 0, top: 0, width: W, height: top * DPR }).toBuffer(), left: 0, top: 0 });
    const part = await region(buf).toBuffer();
    const cut = await sharp(part).extract({ left: 0, top: cutTop, width: W, height: regionH - cutTop - cutBottom }).toBuffer();
    layers.push({ input: cut, left: 0, top: (top + ys[i]) * DPR + cutTop });
  }
  const full = await sharp({ create: { width: W, height: totalH, channels: 3, background: '#fff' } }).composite(layers).png().toBuffer();
  const chunks = path.join(dir, 'chunks');
  fs.rmSync(chunks, { recursive: true, force: true });
  fs.mkdirSync(chunks, { recursive: true });
  let n = 0;
  for (let y = 0; y < totalH; y += MAX_CHUNK) {
    n++;
    await sharp(full).extract({ left: 0, top: y, width: W, height: Math.min(MAX_CHUNK, totalH - y) })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(path.join(chunks, `chunk_${String(n).padStart(2, '0')}.jpg`));
  }
  await sharp(shots[0]).resize({ width: 195 }).jpeg({ quality: 80 }).toFile(path.join(dir, 'first.jpg'));
}

// ---------- optional font measurement ----------
async function measureFonts(page, cdp) {
  const items = await page.evaluate(() => {
    const out = []; let n = 0; const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && out.length < 600) {
      const el = walker.currentNode.parentElement;
      if (!el || seen.has(el) || !walker.currentNode.textContent.trim()) continue;
      seen.add(el);
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || r.left >= innerWidth || r.right <= 0 || s.visibility === 'hidden' || +s.opacity === 0) continue;
      let hidden = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.display === 'none' || as.visibility === 'hidden' || +as.opacity === 0) { hidden = true; break; }
      }
      if (hidden) continue;
      const id = `f${n++}`; el.setAttribute('data-ck-id', id);
      out.push({ id, text: el.innerText.trim().replace(/\s+/g, ' ').slice(0, 40), css: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: parseFloat(s.fontSize), weight: s.fontWeight });
    }
    return out;
  });
  const styles = new Map();
  for (const it of items) { const k = `${it.css}|${it.size}|${it.weight}`; if (!styles.has(k)) styles.set(k, { ...it, count: 0 }); styles.get(k).count++; }
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  await cdp.send('CSS.enable');
  for (const st of styles.values()) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-ck-id="${st.id}"]` }).catch(() => ({}));
    if (!nodeId) continue;
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId }).catch(() => ({ fonts: [] }));
    const top = fonts.slice().sort((a, b) => b.glyphCount - a.glyphCount)[0];
    st.rendered = top?.familyName?.trim() || top?.postScriptName || '';
  }
  return [...styles.values()].map(({ css, rendered, size, weight, count, text }) => ({ css, rendered, size, weight, count, sample: text }));
}

// ---------- navigation ----------
const ALL_RE = /^(전체|전체\s?보기|모두\s?보기|view all|shop all|see all|all|discover all|explore all)$/i;
const SKIP_RE = /(log ?in|로그인|sign ?in|회원가입|join|search|검색|store locator|매장|account|my ?page|마이|cart|장바구니|wish|privacy|개인정보|terms|약관|cookie|contact|고객센터|faq|career|채용|press|news|instagram|facebook|youtube|kakao|app)/i;

const navLinks = (page) => page.evaluate((SKIP) => {
  const re = new RegExp(SKIP, 'i'); const host = location.host.split('.').slice(-2).join('.');
  const seen = new Set(); const out = []; let k = 0;
  for (const a of document.querySelectorAll('a, button, [role=button], [role=tab], [onclick]')) {
    const tt = (a.innerText || a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ');
    const r = a.getBoundingClientRect();
    const hasHref = a.tagName === 'A' && a.getAttribute('href') && !/^(javascript|#)/i.test(a.getAttribute('href'));
    if (!tt || tt.length > 30 || re.test(tt) || seen.has(tt) || (!hasHref && (r.width < 1 || r.height < 1))) continue;
    let href = null;
    if (hasHref) {
      let u; try { u = new URL(a.href); } catch { continue; }
      if (!u.host.endsWith(host) || (u.pathname === location.pathname && u.search === location.search)) continue;
      href = u.href;
    }
    seen.add(tt); a.setAttribute('data-ck-nav', String(++k)); out.push({ t: tt, href, k });
  }
  return out;
}, SKIP_RE.source);

async function follow(page, c) {
  if (c.href) await page.goto(c.href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  else {
    const [np] = await Promise.all([page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null),
      page.locator(`[data-ck-nav="${c.k}"]`).first().click({ timeout: 4000 }).catch(() => {})]);
    if (np) { const u = np.url(); await np.close(); await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); }
  }
  await settle(page); await dismiss(page);
}

const priceCount = (page) => page.evaluate((src) => {
  const re = new RegExp(src); let n = 0;
  for (const e of document.querySelectorAll('body *')) if (e.children.length === 0 && re.test(e.textContent) && e.textContent.trim().length < 40 && e.getBoundingClientRect().width > 0) n++;
  return n;
}, PRICE_RE.source);

async function openMenu(page) {
  const sel = 'button[aria-label*=menu i], button[aria-label*=메뉴], [role=button][aria-label*=menu i], button[class*=menu i], button[class*=hamburger i], [class*=burger i], button[class*=gnb i], a[class*=menu i], button[aria-controls*=menu i], button[aria-controls*=nav i]';
  for (const h of await page.$$(sel)) {
    const b = await h.boundingBox().catch(() => null);
    if (b && b.y < 160 && b.width > 10 && b.width < 120) { await h.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1500); return true; }
  }
  return false;
}

// Priority: configured keywords > "view all" > 3rd menu item. Max 3 depth, max 6 tries, then stop.
async function findScreen(page, screen, home, tried) {
  const kws = (screen.find || []).map((s) => new RegExp(`^(${s})$`, 'i'));
  const loose = (screen.find || []).map((s) => new RegExp(s, 'i'));
  const pick = (links) => {
    const pool = links.filter((l) => !tried.has(l.t));
    for (const re of [...kws, ...loose]) { const l = pool.find((x) => re.test(x.t)); if (l) return l; }
    return pool.find((x) => ALL_RE.test(x.t)) || (pool.length >= 3 ? pool[2] : pool[0]);
  };
  let budget = 6;
  for (let attempt = 0; attempt < 2 && budget > 0; attempt++) {
    await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await settle(page); await dismiss(page); await openMenu(page);
    let links = await navLinks(page);
    for (let depth = 0; depth < 3 && budget > 0; depth++) {
      const l = pick(links); if (!l) break;
      tried.add(l.t); budget--;
      const before = page.url();
      await follow(page, l);
      if (page.url() !== before && page.url() !== home && await priceCount(page) >= (screen.minPrices || 0)) return l.t;
      links = await navLinks(page);
    }
  }
  return null;
}

// click: "price" taps the first price, anything else is a CSS selector. Returns true when the URL changed.
async function clickThrough(page, click) {
  const before = page.url();
  for (let tap = 0; tap < 2; tap++) {
    let target;
    if (click === 'price') {
      const ok = await page.evaluate(([src, t]) => {
        const re = new RegExp(src);
        document.querySelectorAll('[data-ck-detail]').forEach((e) => e.removeAttribute('data-ck-detail'));
        for (const e of document.querySelectorAll('body *')) {
          if (e.children.length || !re.test(e.textContent) || e.textContent.trim().length > 40 || !e.getBoundingClientRect().width) continue;
          if ((t > 0 && e.hasAttribute('data-ck-seen')) || getComputedStyle(e).textDecorationLine.includes('line-through')) continue;
          e.setAttribute('data-ck-detail', '1');
          document.querySelectorAll('body *').forEach((x) => x.children.length || x.setAttribute('data-ck-seen', '1'));
          return true;
        }
        return false;
      }, [PRICE_RE.source, tap]);
      if (!ok) return false;
      target = page.locator('[data-ck-detail="1"]').first();
    } else target = page.locator(click).nth(tap);
    await target.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {});
    await page.waitForTimeout(600);
    const [np] = await Promise.all([page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null), target.click({ timeout: 5000 }).catch(() => {})]);
    if (np) { const u = np.url(); await np.close(); await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); }
    await settle(page, 3000);
    if (page.url() !== before) { await dismiss(page); return true; }
  }
  return false;
}

// ---------- language ----------
async function langUrl(page, lang) {
  const alt = await page.evaluate(() => [...document.querySelectorAll('link[rel=alternate][hreflang]')].map((l) => [l.hreflang.toLowerCase(), l.href]));
  const hit = alt.find(([h]) => [`${lang}-kr`, `${lang}-us`, `${lang}-gb`].includes(h)) || alt.find(([h]) => h.startsWith(lang));
  if (hit) return hit[1];
  const cur = page.url();
  const swaps = lang === 'ko'
    ? [[/\/(us|int|gb|uk|ww|en)\/en(-[a-z]+)?\//i, '/kr/ko/'], [/\/en-us\//i, '/ko-kr/'], [/\/en(-[a-z]+)?\//i, '/ko/']]
    : [[/\/kr\/ko\//i, '/us/en/'], [/\/ko(-kr)?\//i, '/en/']];
  for (const [a, b] of swaps) if (a.test(cur)) return cur.replace(a, b);
  return cur;
}
const isLang = async (page, lang) => {
  const hr = await page.evaluate(() => { const t = document.body.innerText.slice(0, 4000); return (t.match(/[가-힣]/g) || []).length / Math.max(1, t.replace(/\s/g, '').length); });
  if (lang === 'ko') return hr > 0.2;
  if (lang === 'en') return hr < 0.05;
  return true;
};

// ---------- review sheet ----------
async function reviewSheet() {
  const thumbs = [];
  for (const site of cfg.sites) for (const lang of cfg.languages) for (const sc of cfg.screens) {
    const p = path.join(OUT, safe(site.name), lang, safe(sc.name), 'first.jpg');
    if (fs.existsSync(p)) thumbs.push({ p, label: `${site.name} / ${sc.name} / ${lang}` });
  }
  if (!thumbs.length) return;
  const CW = 205, CH = Math.round(195 * VH / VW) + 34, COLS = Math.min(8, thumbs.length);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const layers = [];
  for (const [i, t] of thumbs.entries()) {
    const x = (i % COLS) * CW + 5, y = Math.floor(i / COLS) * CH + 5;
    layers.push({ input: Buffer.from(`<svg width="195" height="26"><text x="0" y="17" font-size="12" font-family="Apple SD Gothic Neo, sans-serif">${esc(t.label)}</text></svg>`), left: x, top: y });
    layers.push({ input: t.p, left: x, top: y + 26 });
  }
  await sharp({ create: { width: COLS * CW + 10, height: Math.ceil(thumbs.length / COLS) * CH + 10, channels: 3, background: '#fff' } })
    .composite(layers).jpeg({ quality: 85 }).toFile(path.join(OUT, 'review.jpg'));
}

// ---------- main ----------
async function runSite(browser, site) {
  const tried = new Set();
  let termsDone = false;
  if (!await robotsOk(site.url)) { log(site.name, '-', '-', 'robots', 'robots.txt가 시작 URL 수집을 막고 있어 건너뜀'); return; }
  for (const lang of cfg.languages) {
    const ctx = await browser.newContext({ ...DEVICE, locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    try {
      const resp = await goto(page, site.url);
      if (await isBlocked(page, resp)) { log(site.name, lang, '-', 'blocked', '봇 차단 화면. 우회하지 않음. 수동 캡처 대상'); continue; }
      await dismiss(page);
      if (!termsDone && site.terms !== 'ok') {
        const t = await termsCheck(page);
        log(site.name, '-', '약관', t.status, t.note);
        // A site is captured only when the check found terms and no ban, or a person set "terms": "ok".
        if (t.status !== 'ok') return;
        termsDone = true;
      }
      await goto(page, site.url); await dismiss(page);
      let home = site.url;
      if (cfg.languages.length > 1) {
        home = await langUrl(page, lang);
        await goto(page, home); await dismiss(page);
        if (await isBlocked(page, null)) { log(site.name, lang, '-', 'blocked', '봇 차단 화면. 우회하지 않음. 수동 캡처 대상'); continue; }
        if (!await isLang(page, lang)) { log(site.name, lang, '-', 'skip', `이 언어 화면을 찾지 못함: ${home}`); continue; }
      }
      const urls = {};
      for (const sc of cfg.screens) {
        const dir = path.join(OUT, safe(site.name), lang, safe(sc.name));
        const metaPath = path.join(dir, 'meta.json');
        if (fs.existsSync(metaPath)) { urls[sc.name] = JSON.parse(fs.readFileSync(metaPath, 'utf8')).url; continue; }
        try {
          const direct = site.urls?.[sc.name];
          if (direct && !await robotsOk(direct)) { log(site.name, lang, sc.name, 'robots', direct); continue; }
          if (direct) { await goto(page, direct); await dismiss(page); }
          else if (sc.find) {
            if (!await findScreen(page, sc, home, tried)) { log(site.name, lang, sc.name, 'skip', '조건에 맞는 화면을 찾지 못함'); continue; }
          } else if (sc.from) {
            if (!urls[sc.from]) { log(site.name, lang, sc.name, 'skip', `${sc.from} 화면이 없어 건너뜀`); continue; }
            await goto(page, urls[sc.from]); await dismiss(page);
            if (!await clickThrough(page, sc.click || 'price')) { log(site.name, lang, sc.name, 'skip', '클릭할 대상을 찾지 못함'); continue; }
          } else { await goto(page, home); await dismiss(page); }
          if (await isBlocked(page, null)) { log(site.name, lang, sc.name, 'blocked', page.url()); break; }
          if (!await robotsOk(page.url())) { log(site.name, lang, sc.name, 'robots', page.url()); continue; }
          fs.mkdirSync(dir, { recursive: true });
          await warmScroll(page); await dismiss(page);
          const cap = await captureScreen(page, dir);
          const fonts = cfg.measureFonts ? await measureFonts(page, cdp) : undefined;
          urls[sc.name] = page.url();
          fs.writeFileSync(metaPath, JSON.stringify({ site: site.name, lang, screen: sc.name, url: page.url(), ...cap, fonts }, null, 1));
          log(site.name, lang, sc.name, 'done', `${cap.shots}장${cap.truncated ? ', 길이 제한으로 잘림' : ''}`);
        } catch (e) { log(site.name, lang, sc.name, 'fail', e.message.split('\n')[0]); }
      }
    } catch (e) { log(site.name, lang, '-', 'fail', e.message.split('\n')[0]); }
    finally { await ctx.close(); }
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: [`--window-size=${VW + 70},${VH + 150}`] });
try {
  for (const site of cfg.sites) if (!ONLY || site.name === ONLY) await runSite(browser, site);
} finally { await browser.close(); }
await reviewSheet();
if (cfg.measureFonts) {
  const rows = ['site,lang,screen,css_font,rendered_font,size,weight,count,sample'];
  for (const site of cfg.sites) for (const lang of cfg.languages) for (const sc of cfg.screens) {
    const p = path.join(OUT, safe(site.name), lang, safe(sc.name), 'meta.json');
    if (!fs.existsSync(p)) continue;
    for (const f of JSON.parse(fs.readFileSync(p, 'utf8')).fonts || []) rows.push([site.name, lang, sc.name, f.css, f.rendered, f.size, f.weight, f.count, f.sample].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  }
  fs.writeFileSync(path.join(OUT, 'fonts.csv'), `﻿${rows.join('\n')}\n`);
}
console.log(`\n끝. 결과 확인: ${path.join(OUT, 'review.jpg')} / ${REPORT}`);
