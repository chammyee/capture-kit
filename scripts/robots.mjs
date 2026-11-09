// Minimal robots.txt rules for the "*" user agent: longest match wins, Allow wins ties.
export function parseRobots(txt) {
  const rules = []; let active = false, inAgents = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') { active = (inAgents ? active : false) || val === '*'; inAgents = true; continue; }
    inAgents = false;
    if (active && (key === 'allow' || key === 'disallow') && val) rules.push({ allow: key === 'allow', path: val });
  }
  return rules;
}
const toRe = (p) => new RegExp(`^${p.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}`);
export function robotsAllows(rules, pathAndQuery) {
  let best = null;
  for (const r of rules) {
    if (!toRe(r.path).test(pathAndQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}
