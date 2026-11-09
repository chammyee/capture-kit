// POST images to the single-use URLs returned by Figma MCP upload_assets.
// usage: npm run upload -- <figma-import folder> <list.txt>   (each line: "0001.jpg https://mcp.figma.com/...")
import fs from 'node:fs';
import path from 'node:path';

export const allowed = (u) => { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'mcp.figma.com'; };

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [dir, list] = process.argv.slice(2);
  const jobs = fs.readFileSync(list, 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/));
  for (const [, url] of jobs) if (!allowed(url)) throw new Error(`Figma 주소가 아니라 중단합니다: ${url}`);
  let failed = 0, next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < jobs.length) {
      const [file, url] = jobs[next++];
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(path.join(dir, file)) }).catch((e) => ({ ok: false, status: e.message }));
      if (!res.ok) { failed++; console.log(`실패 ${file}: ${res.status}`); }
    }
  }));
  console.log(`완료 ${jobs.length - failed}개, 실패 ${failed}개`);
  if (failed) process.exitCode = 1;
}
