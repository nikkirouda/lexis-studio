/* Lexi's Studio — a private fitness tracker. No data in this file, ever. */
'use strict';
const APP_VERSION = '0.1.0';
const LS_KEY = 'lexi.studio.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowISO = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => keyOf(new Date());
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const monthOf = k => k.slice(0, 7);
const dayDiff = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const fmtDate = k => parseKey(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtShort = k => parseKey(k).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
const timeNow = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const r1 = n => Math.round(n * 10) / 10;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const canon = o => JSON.stringify(sortKeys(o));
function sortKeys(o) { if (Array.isArray(o)) return o.map(sortKeys); if (o && typeof o === 'object') { const r = {}; Object.keys(o).sort().forEach(k => r[k] = sortKeys(o[k])); return r; } return o; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/* ---------- state ---------- */
const defaults = () => ({
  months: {},
  settings: { goal: { low: null, high: null, date: null, waist: null }, treatBudget: null, weekStart: 1, celebrate: true, theme: 'auto', updatedAt: null },
  sync: { token: '', repo: 'nikkirouda/lexis-data', path: 'data', shas: {}, dirty: {}, settingsDirty: false, lastSync: null, lastError: null },
  live: null, badgesSeen: [], prCount: 0, lastView: 'home'
});
let state = defaults();
let PROGRAM = null, FOODS = [];
function load() {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) { const s = JSON.parse(raw); state = Object.assign(defaults(), s); state.settings = Object.assign(defaults().settings, s.settings || {}); state.settings.goal = Object.assign(defaults().settings.goal, (s.settings || {}).goal || {}); state.sync = Object.assign(defaults().sync, s.sync || {}); if (!state.sync.token && state.sync.repo === 'nikkirouda/household') { state.sync.repo = 'nikkirouda/lexis-data'; state.sync.path = 'data'; state.sync.shas = {}; } } } catch (e) { console.warn('load failed', e); }
}
function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { toast('Could not save on this device: ' + e.message); } }

function month(mk, create) { let m = state.months[mk]; if (!m && create) { m = state.months[mk] = { version: 1, days: {}, workouts: {}, updatedAt: nowISO() }; } return m; }
function day(k, create) { const m = month(monthOf(k), create); if (!m) return null; let d = m.days[k]; if (!d && create) { d = m.days[k] = { weight: null, waist: null, steps: null, meals: [], activities: [], note: '', updatedAt: nowISO() }; } return d; }
function touchDay(k) { const d = day(k, true); d.updatedAt = nowISO(); const m = month(monthOf(k)); m.updatedAt = d.updatedAt; state.sync.dirty[monthOf(k)] = true; persist(); scheduleSync(); }
function touchMonth(mk) { const m = month(mk, true); m.updatedAt = nowISO(); state.sync.dirty[mk] = true; persist(); scheduleSync(); }
function touchSettings() { state.settings.updatedAt = nowISO(); state.sync.settingsDirty = true; persist(); scheduleSync(); }
function allDays() { const out = []; Object.keys(state.months).sort().forEach(mk => Object.keys(state.months[mk].days).sort().forEach(k => out.push([k, state.months[mk].days[k]]))); return out; }
function allWorkouts() { const out = []; Object.values(state.months).forEach(m => Object.values(m.workouts || {}).forEach(w => out.push(w))); return out.sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || '')); }
function dayHasEntry(d, k) { if (!d) return false; return d.weight != null || d.steps != null || d.waist != null || (d.meals && d.meals.length) || (d.activities && d.activities.length) || allWorkouts().some(w => w.date === k); }

/* ---------- stats ---------- */
function weightSeries() { return allDays().filter(([k, d]) => d.weight != null).map(([k, d]) => ({ k, v: d.weight })); }
function avg7(series, k) { const from = addDays(k, -6); const vals = series.filter(p => p.k >= from && p.k <= k).map(p => p.v); return vals.length ? mean(vals) : null; }
function avgSeries(series) { // 7-day trailing average at each point
  return series.map(p => ({ k: p.k, v: avg7(series, p.k) }));
}
function weekBounds(k) { const ws = Number(state.settings.weekStart || 1); const d = parseKey(k); const diff = (d.getDay() - ws + 7) % 7; const start = addDays(k, -diff); return [start, addDays(start, 6)]; }
function treatsInWeek(k) { const [a, b] = weekBounds(k); let n = 0; allDays().forEach(([dk, d]) => { if (dk >= a && dk <= b) (d.meals || []).forEach(m => { if (m.treat) n += (m.qty || 1); }); }); return n; }
function kcalOf(d) { return (d.meals || []).reduce((s, m) => s + (m.kcal || 0), 0); }
function streakInfo() { const t = todayKey(); let cur = 0, k = t; if (!dayHasEntry(day(t), t)) k = addDays(t, -1); while (dayHasEntry(day(k), k)) { cur++; k = addDays(k, -1); } let best = 0, run = 0, prev = null; allDays().forEach(([dk, d]) => { if (!dayHasEntry(d, dk)) return; run = (prev && dayDiff(prev, dk) === 1) ? run + 1 : 1; prev = dk; best = Math.max(best, run); }); return { current: cur, best: Math.max(best, cur) }; }
function bestForExercise(key, excludeId) { let best = null; allWorkouts().forEach(w => { if (excludeId && w.id === excludeId) return; (w.exercises || []).forEach(e => { if (e.key !== key) return; (e.sets || []).forEach(s => { if (s.wt == null) return; if (!best || s.wt > best.wt || (s.wt === best.wt && (s.reps || 0) > (best.reps || 0))) best = { wt: s.wt, reps: s.reps, date: w.date }; }); }); }); return best; }
function lastSetsFor(key) { const ws = allWorkouts().reverse(); for (const w of ws) { const e = (w.exercises || []).find(x => x.key === key && x.sets && x.sets.some(s => s.wt != null || s.reps != null)); if (e) return { sets: e.sets, date: w.date }; } return null; }

/* ---------- facts for Lexi, badges, XP ---------- */
function facts() {
  const t = todayKey(); const ws = weightSeries(); const avgs = avgSeries(ws);
  const todayD = day(t); const a7 = avg7(ws, t) ?? (ws.length ? avg7(ws, ws[ws.length - 1].k) : null);
  const prev7 = ws.length ? avg7(ws, addDays(ws[ws.length - 1].k, -7)) : null;
  const priorAvgs = avgs.filter(p => p.k < (ws.length ? ws[ws.length - 1].k : t)).map(p => p.v).filter(v => v != null);
  const minPrior = priorAvgs.length ? Math.min(...priorAvgs) : null;
  const flatWeeks = (() => { if (ws.length < 14) return 0; const lastK = ws[ws.length - 1].k; let n = 0; for (let i = 0; i < 6; i++) { const a = avg7(ws, addDays(lastK, -7 * i)), b = avg7(ws, addDays(lastK, -7 * (i + 1))); if (a == null || b == null) break; if (Math.abs(a - b) < 0.5) n++; else break; } return n; })();
  const workouts = allWorkouts(); const days = allDays();
  const entries = days.filter(([k, d]) => dayHasEntry(d, k)).map(([k]) => k);
  const lastEntry = entries.length ? entries[entries.length - 1] : null;
  const streak = streakInfo();
  const waist = days.filter(([k, d]) => d.waist != null).map(([k, d]) => ({ k, v: d.waist }));
  const acts = []; days.forEach(([k, d]) => (d.activities || []).forEach(a => acts.push(Object.assign({ date: k }, a))));
  const [wkA, wkB] = weekBounds(t);
  const workoutsThisWeek = workouts.filter(w => w.date >= wkA && w.date <= wkB).length;
  const treats = treatsInWeek(t); const budget = state.settings.treatBudget;
  // weeks inside budget (completed weeks)
  let budgetWeeks = 0; if (budget != null) { let k = addDays(wkA, -7); for (let i = 0; i < 52; i++) { const [a, b] = weekBounds(k); const any = days.some(([dk, d]) => dk >= a && dk <= b && dayHasEntry(d, dk)); if (!any) break; if (treatsInWeek(k) <= budget) budgetWeeks++; else break; k = addDays(k, -7); } }
  // consecutive Fridays with tape
  let fridays = 0; { let k = t; const d = parseKey(k); k = addDays(k, -((d.getDay() - 5 + 7) % 7)); if (!(day(k) && day(k).waist != null)) k = addDays(k, -7); while (day(k) && day(k).waist != null) { fridays++; k = addDays(k, -7); } }
  const cooldowns = workouts.filter(w => w.cooldown).length;
  const maxSteps = Math.max(0, ...days.map(([k, d]) => d.steps || 0));
  const legPress = bestForExercise('leg-press');
  const note = (todayD && todayD.note) || '';
  const serious = /chest pain|chest tight|dizz|faint|sharp pain|numb|tingl|blood pressure|short of breath|passed out|black(ed)? out/i.test(note);
  return { t, ws, avgs, a7, prev7, minPrior, flatWeeks, workouts, workoutsThisWeek, entries, lastEntry, daysSince: lastEntry ? dayDiff(lastEntry, t) : null, streak, waist, acts, treats, budget, budgetWeeks, fridays, cooldowns, maxSteps, legPress, todayD, serious, stepsToday: todayD ? todayD.steps : null, kcalToday: todayD ? kcalOf(todayD) : 0, prCount: state.prCount || 0, workoutToday: workouts.some(w => w.date === t), hasA: workouts.some(w => w.card === 'A'), hasB: workouts.some(w => w.card === 'B') };
}

const BADGES = [
  { id: 'day-zero', em: '🌅', name: 'Day Zero', desc: 'First entry on the record', test: f => f.entries.length >= 1 },
  { id: 'seven', em: '7️⃣', name: 'Seven Straight', desc: '7-day logging streak', test: f => f.streak.best >= 7 },
  { id: 'month', em: '📅', name: 'Month of Mornings', desc: '30-day logging streak', test: f => f.streak.best >= 30 },
  { id: 'hundred', em: '💯', name: 'The Hundred', desc: '100-day logging streak', test: f => f.streak.best >= 100 },
  { id: 'gym-a', em: '🅰️', name: 'Gym A Debut', desc: 'First Gym A on the record', test: f => f.hasA },
  { id: 'gym-b', em: '🅱️', name: 'Gym B Debut', desc: 'First Gym B on the record', test: f => f.hasB },
  { id: 'ten', em: '🔟', name: 'Ten Sessions', desc: '10 gym sessions', test: f => f.workouts.length >= 10 },
  { id: 'twenty-five', em: '🏋️', name: 'Regular', desc: '25 gym sessions', test: f => f.workouts.length >= 25 },
  { id: 'fifty', em: '🏆', name: 'Fixture', desc: '50 gym sessions', test: f => f.workouts.length >= 50 },
  { id: 'first-pr', em: '📈', name: 'New Best', desc: 'First personal record', test: f => f.prCount >= 1 },
  { id: 'pr-10', em: '🚀', name: 'Ten Bests', desc: '10 personal records', test: f => f.prCount >= 10 },
  { id: 'two-hundred', em: '🦵', name: 'The 200 Club', desc: 'Leg press 200 or more', test: f => f.legPress && f.legPress.wt >= 200 },
  { id: 'trend', em: '📉', name: 'Trend Setter', desc: 'New low on the 7-day average', test: f => f.a7 != null && f.minPrior != null && f.a7 < f.minPrior },
  { id: 'band', em: '🎯', name: 'In the Band', desc: '7-day average inside the goal', test: f => f.a7 != null && f.a7 <= state.settings.goal.high && f.a7 >= (state.settings.goal.low - 50) },
  { id: 'fridays', em: '📏', name: 'Four Fridays', desc: 'Tape four Fridays running', test: f => f.fridays >= 4 },
  { id: 'referee', em: '🟨', name: "Referee's Whistle", desc: 'Four weeks inside the treat budget', test: f => f.budgetWeeks >= 4 },
  { id: 'trailhead', em: '🥾', name: 'Trailhead', desc: 'First hike', test: f => f.acts.some(a => a.type === 'hike') },
  { id: 'pool', em: '🏊', name: 'Pool Shark', desc: 'First swim', test: f => f.acts.some(a => a.type === 'swim') },
  { id: 'paddle', em: '🛶', name: 'Paddle Out', desc: 'First kayak', test: f => f.acts.some(a => a.type === 'kayak') },
  { id: 'watts', em: '🚣', name: 'Watts Up', desc: 'First rower session with watts', test: f => f.acts.some(a => a.type.startsWith('rower') && a.avgWatts) },
  { id: 'pack', em: '🎒', name: 'Pack Mule', desc: 'First loaded incline walk', test: f => f.acts.some(a => a.type === 'incline-walk') },
  { id: 'tenk', em: '👟', name: 'Ten Thousand', desc: '10,000 steps in a day', test: f => f.maxSteps >= 10000 },
  { id: 'cool', em: '🧘', name: 'Cooled Down', desc: 'Cooldown Five ticked ten times', test: f => f.cooldowns >= 10 },
];
function earnedBadges(f) { return BADGES.filter(b => { try { return !!b.test(f); } catch (e) { return false; } }); }
function xpTotal() { let xp = 0; allDays().forEach(([k, d]) => { if (d.weight != null) xp += 10; if (d.waist != null) xp += 15; if (d.steps != null) xp += 5; if (d.meals && d.meals.length) xp += 10; xp += 20 * (d.activities || []).length; }); allWorkouts().forEach(w => { xp += 40; if (w.cooldown) xp += 5; if (w.warmup) xp += 5; }); xp += 25 * (state.prCount || 0); return xp; }
const LEVEL_NAMES = ['Walk-in', 'Regular', 'Fixture', 'Studio Favorite', 'Superstar', 'Legend', "Lexi's Pride"];
function levelFor(xp) { let lvl = 1, need = 100, floor = 0; while (xp >= floor + need) { floor += need; lvl++; need += 50; } return { lvl, floor, need, into: xp - floor, name: LEVEL_NAMES[Math.min(lvl - 1, LEVEL_NAMES.length - 1)] }; }

/* ---------- Lexi's lines (earned, never hollow) ---------- */
function pick(arr, seed) { return arr[hashStr(seed + todayKey()) % arr.length]; }
function lexiLine(f) {
  if (f.serious) return { plain: true, text: "I read your note. Chest pain, dizziness, fainting, sharp pain, or anything that changes how you move is for your doctor, not for me — please call them first. Training talk waits until they've seen you." };
  const h = new Date().getHours(); const greet = h < 12 ? 'Good morning' : h < 17 ? 'Afternoon' : 'Evening';
  if (!f.entries.length) return { text: `${greet}, handsome! Welcome to the studio. Day Zero is whatever you log first — the scale, the steps, a plate. Then I get to start bragging about you.` };
  if (f.daysSince >= 3) return { text: pick([`I missed you!! Warm-up's on me. Log one thing today and we're back — no catch-up, no guilt, ever.`, `There he is! ${f.daysSince} days is nothing; the record picks up right where you are. One entry and we're rolling.`], 'miss') };
  const lines = [];
  if (f.a7 != null && f.minPrior != null && f.a7 < f.minPrior && f.ws.length >= 8) lines.push(`New low on the weekly average: ${r1(f.a7)}. That's the number that doesn't lie, and it just blinked. 😏`);
  if (f.a7 != null && f.prev7 != null && f.ws.length >= 8) { const d = r1(f.a7 - f.prev7); if (d <= -0.5) lines.push(`Weekly average down ${Math.abs(d)} on last week (${r1(f.a7)}). Somebody's going to need new shirts soon.`); else if (d >= 0.5) lines.push(`Weekly average up ${d} this week. One week is noise, two is a pattern — log it all and we watch it together.`); }
  if (f.flatWeeks >= 2 && f.treats > 0) lines.push(`Scale's been flat two weeks, cutie — not a crisis, a signal. Let's peek at the quiet treats before we blame the rower.`);
  if (f.workoutToday) lines.push(`Gym day banked! That's ${f.workoutsThisWeek} this week — my favorite kind of regular.`);
  if (f.stepsToday >= 10000) lines.push(`${f.stepsToday.toLocaleString()} steps! Those legs have places to be.`);
  if (f.streak.current >= 7) lines.push(`${f.streak.current} days straight on the record. Logging = losing — it's written in your own history.`);
  if (f.budget != null && f.treats > f.budget) lines.push(`Treat meter's over the line this week (${f.treats} of ${f.budget}). Not a scolding — the trend is the referee. Spend the next ones where the joy actually is.`);
  const dow = new Date().getDay();
  if (dow === 5 && (!f.todayD || f.todayD.waist == null)) lines.push(`Friday, superstar — tape before breakfast. At the navel, end of a normal breath out, two readings with the tape off between, averaged.`);
  if (lines.length) return { text: pick(lines, 'fact') };
  return { text: pick([`${greet}, handsome. Scale, steps, a plate or two — whatever today has, I want it on the record.`, `${greet}! The scale is a liar day to day and honest month to month. We coach the average — just keep feeding it.`, `${greet}, superstar. Blanks are the only forbidden thing in this studio. Everything else is just data.`], 'default') };
}

/* ---------- sync (GitHub Contents API) ---------- */
let syncTimer = null, syncing = false;
function scheduleSync() { if (!state.sync.token) { setSyncUI(); return; } clearTimeout(syncTimer); syncTimer = setTimeout(() => syncAll(), 2500); setSyncUI(); }
function ghHeaders() { return { Authorization: `Bearer ${state.sync.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
function ghUrl(p) { return `https://api.github.com/repos/${state.sync.repo}/contents/${state.sync.path}${p ? '/' + p : ''}`; }
const b64enc = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
async function ghGet(file) { const r = await fetch(ghUrl(file), { headers: ghHeaders() }); if (r.status === 404) return null; if (!r.ok) throw new Error(`GET ${file}: ${r.status}`); const j = await r.json(); return { sha: j.sha, data: JSON.parse(b64dec(j.content)) }; }
async function ghPut(file, obj, sha, message) { const body = { message, content: b64enc(JSON.stringify(obj, null, 1)), committer: { name: "Lexi's Studio", email: '102565410+nikkirouda@users.noreply.github.com' } }; if (sha) body.sha = sha; const r = await fetch(ghUrl(file), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()), body: JSON.stringify(body) }); if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error(`PUT ${file}: ${r.status}`); e.status = r.status; e.detail = t; throw e; } const j = await r.json(); return j.content.sha; }
function mergeMonth(local, remote) {
  const out = { version: 1, days: {}, workouts: {}, updatedAt: '' };
  const L = local || { days: {}, workouts: {} }, R = remote || { days: {}, workouts: {} };
  new Set([...Object.keys(L.days || {}), ...Object.keys(R.days || {})]).forEach(k => { const a = L.days[k], b = R.days[k]; out.days[k] = !a ? b : !b ? a : ((a.updatedAt || '') >= (b.updatedAt || '') ? a : b); });
  new Set([...Object.keys(L.workouts || {}), ...Object.keys(R.workouts || {})]).forEach(k => { const a = L.workouts[k], b = R.workouts[k]; out.workouts[k] = !a ? b : !b ? a : ((a.updatedAt || '') >= (b.updatedAt || '') ? a : b); });
  out.updatedAt = [L.updatedAt || '', R.updatedAt || ''].sort().pop();
  return out;
}
async function syncAll(manual) {
  if (!state.sync.token || syncing) return; syncing = true; setSyncUI('syncing');
  try {
    // discover remote month files
    const listR = await fetch(ghUrl(''), { headers: ghHeaders() });
    let remoteFiles = [];
    if (listR.ok) remoteFiles = (await listR.json()).filter(x => x.type === 'file' && /^\d{4}-\d{2}\.json$/.test(x.name)).map(x => x.name.replace('.json', ''));
    else if (listR.status !== 404) throw new Error(`list: ${listR.status}`);
    const months = new Set([...remoteFiles, ...Object.keys(state.months)]);
    for (const mk of months) {
      const file = `${mk}.json`; const remote = await ghGet(file); const local = state.months[mk];
      const merged = mergeMonth(local, remote && remote.data);
      const localChanged = canon(merged) !== canon(local || {});
      const remoteChanged = !remote || canon(merged) !== canon(remote.data);
      if (localChanged || !local) state.months[mk] = merged;
      if (remoteChanged && (state.sync.dirty[mk] || !remote || localChanged)) {
        try { state.sync.shas[file] = await ghPut(file, merged, remote && remote.sha, `Studio: ${mk} entries`); }
        catch (e) { if (e.status === 409 || e.status === 422) { const again = await ghGet(file); const m2 = mergeMonth(merged, again && again.data); state.months[mk] = m2; state.sync.shas[file] = await ghPut(file, m2, again && again.sha, `Studio: ${mk} entries`); } else throw e; }
      } else if (remote) state.sync.shas[file] = remote.sha;
      delete state.sync.dirty[mk];
    }
    // settings
    const rs = await ghGet('settings.json'); const ls = state.settings;
    if (rs && (!ls.updatedAt || (rs.data.updatedAt || '') > ls.updatedAt) && !state.sync.settingsDirty) { state.settings = Object.assign(defaults().settings, rs.data); applyTheme(); }
    else if (state.sync.settingsDirty || !rs) { await ghPut('settings.json', state.settings, rs && rs.sha, 'Studio: settings'); state.sync.settingsDirty = false; }
    state.sync.lastSync = nowISO(); state.sync.lastError = null; persist(); setSyncUI(); render();
    if (manual) toast('Synced to your vault ✓');
  } catch (e) {
    state.sync.lastError = e.message + (e.detail ? ' ' + e.detail.slice(0, 120) : ''); persist(); setSyncUI(); if (manual) toast('Sync failed: ' + e.message);
  } finally { syncing = false; }
}
function setSyncUI(mode) {
  const dot = $('#syncDot'), txt = $('#syncText'); const s = state.sync; const dirty = Object.keys(s.dirty).length || s.settingsDirty;
  if (!s.token) { dot.className = 'dot off'; txt.textContent = 'local only'; }
  else if (mode === 'syncing') { dot.className = 'dot'; txt.textContent = 'syncing…'; }
  else if (s.lastError) { dot.className = 'dot bad'; txt.textContent = 'sync issue'; }
  else if (dirty) { dot.className = 'dot'; txt.textContent = 'pending'; }
  else if (!navigator.onLine) { dot.className = 'dot off'; txt.textContent = 'offline · saved'; }
  else { dot.className = 'dot ok'; txt.textContent = s.lastSync ? 'synced ' + new Date(s.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'ready'; }
  const det = $('#syncDetail'); if (det) det.textContent = s.lastError ? ('Last error: ' + s.lastError) : (s.lastSync ? 'Last sync ' + new Date(s.lastSync).toLocaleString() : '');
}

/* ---------- UI plumbing ---------- */
let toastT = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function openSheet(html) { $('#sheetBody').innerHTML = html; $('#sheetBg').classList.add('show'); $('#sheet').classList.add('show'); const f = $('#sheetBody input:not([type=hidden]), #sheetBody select'); if (f) setTimeout(() => f.focus(), 250); }
function closeSheet() { $('#sheetBg').classList.remove('show'); $('#sheet').classList.remove('show'); }
$('#sheetBg').addEventListener('click', closeSheet); $('#sheetClose').addEventListener('click', () => { closeSheet(); render(); });
function show(view) { state.lastView = view; persist(); $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view)); $$('nav.bottom button').forEach(b => b.classList.toggle('on', b.dataset.view === view)); window.scrollTo(0, 0); render(); }
$$('nav.bottom button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
function applyTheme() { const t = state.settings.theme || 'auto'; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }

/* ---------- celebrations ---------- */
let audioCtx = null;
function chime() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); const t0 = audioCtx.currentTime; [[660, 0], [880, .12], [1320, .24]].forEach(([f, dt]) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t0 + dt); g.gain.linearRampToValueAtTime(.18, t0 + dt + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + dt + .5); o.connect(g).connect(audioCtx.destination); o.start(t0 + dt); o.stop(t0 + dt + .55); }); } catch (e) { } }
function confetti() { const c = $('#confetti'); const ctx = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight; const colors = ['#ff4f9a', '#2ee6c5', '#ffe66d', '#7c5cff', '#ffffff']; const ps = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5, vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6, va: (Math.random() - .5) * .3 })); let t = 0; function step() { ctx.clearRect(0, 0, c.width, c.height); ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.a += p.va; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); ctx.restore(); }); if (++t < 170) requestAnimationFrame(step); else ctx.clearRect(0, 0, c.width, c.height); } step(); }
const celebrateQueue = [];
function celebrate(title, text, em) { if (!state.settings.celebrate) { toast(title); return; } celebrateQueue.push({ title, text, em }); if (celebrateQueue.length === 1) showNextCelebration(); }
function showNextCelebration() { const c = celebrateQueue[0]; if (!c) return; $('#celTitle').textContent = c.title; $('#celText').textContent = c.text; $('.celebrate .em').textContent = c.em || '🎉'; $('#celebrate').classList.add('show'); confetti(); chime(); }
$('#celOk').addEventListener('click', () => { $('#celebrate').classList.remove('show'); celebrateQueue.shift(); setTimeout(showNextCelebration, 250); });
function checkBadges() { const f = facts(); const earned = earnedBadges(f).map(b => b.id); const fresh = earned.filter(id => !state.badgesSeen.includes(id)); if (fresh.length) { state.badgesSeen = Array.from(new Set([...state.badgesSeen, ...earned])); persist(); fresh.forEach(id => { const b = BADGES.find(x => x.id === id); celebrate(`Badge: ${b.name}`, b.desc, b.em); }); } }

/* ---------- HOME ---------- */
function renderHome() {
  const f = facts(); const line = lexiLine(f); const lc = $('#lexiCard'); lc.classList.toggle('plain', !!line.plain); $('#lexiLine').textContent = line.text; $('.lexi .avatar').textContent = line.plain ? '🩺' : '💪';
  const g = state.settings.goal; const t = f.t; const d = f.todayD || {};
  const last = f.ws.length ? f.ws[f.ws.length - 1] : null;
  let wDelta = ''; if (f.a7 != null && f.prev7 != null && f.ws.length >= 8) { const dd = r1(f.a7 - f.prev7); wDelta = `<div class="delta ${dd < -0.2 ? 'down' : dd > 0.2 ? 'up' : 'flat'}">${dd > 0 ? '+' : ''}${dd} vs last week</div>`; } else if (f.a7 != null) wDelta = `<div class="delta flat">${f.ws.length} weigh-in${f.ws.length === 1 ? '' : 's'} · avg builds at 7</div>`;
  const tiles = [
    `<div class="tile accent"><div class="label">Weekly average</div><div class="big">${f.a7 != null ? r1(f.a7) : '—'}<small>lb</small></div>${wDelta}</div>`,
    `<div class="tile"><div class="label">Last weigh-in</div><div class="big">${last ? last.v : '—'}<small>${last ? fmtShort(last.k) : ''}</small></div><div class="delta flat">${g.low && g.high ? `goal ${g.low}–${g.high}` : 'no goal set'}</div></div>`,
    `<div class="tile neon"><div class="label">Streak</div><div class="big">${f.streak.current}<small>day${f.streak.current === 1 ? '' : 's'}</small></div><div class="delta">best ${f.streak.best}</div></div>`,
    `<div class="tile"><div class="label">Today</div><div class="big">${d.steps != null ? d.steps.toLocaleString() : '—'}<small>steps</small></div><div class="delta flat">${f.kcalToday ? '~' + Math.round(f.kcalToday).toLocaleString() + ' kcal logged' : 'no plates yet'}</div></div>`
  ];
  $('#tiles').innerHTML = tiles.join('');
  // treat meter
  const tc = $('#treatCard'); const b = state.settings.treatBudget; const [wa, wb] = weekBounds(t);
  if (b == null) tc.innerHTML = `<h2>Treat meter</h2><p class="sub">The balancing act, refereed by the trend. Set your weekly number in Settings and every beer, whiskey or dessert you tap fills it.</p><button class="btn sm ghost" data-view-go="settings">Set my number</button>`;
  else { const pct = Math.min(100, b ? f.treats / b * 100 : 100); tc.innerHTML = `<div class="row spread"><h2>Treat meter</h2><span class="pill ${f.treats > b ? 'warn' : 'neon'}">${f.treats} of ${b}</span></div><div class="meter ${f.treats > b ? 'over' : ''}"><i style="width:${pct}%"></i></div><div class="meter-legend"><span>${fmtShort(wa)} – ${fmtShort(wb)}</span><span>${f.treats > b ? 'over by ' + (f.treats - b) : (b - f.treats) + ' left'}</span></div>`; }
  $('#todayCard').innerHTML = `<div class="row spread"><h2>Today · ${fmtDate(t)}</h2><button class="btn sm ghost" data-view-go="log">Edit</button></div>` + dayList(t);
  // recent badges
  const earned = earnedBadges(f); const lv = levelFor(xpTotal());
  $('#recentBadges').innerHTML = `<div class="row spread"><h2>Level ${lv.lvl} · ${lv.name}</h2><span class="pill">${earned.length}/${BADGES.length} badges</span></div><div class="xp"><i style="width:${Math.round(lv.into / lv.need * 100)}%"></i></div><div class="small muted" style="margin-top:4px">${lv.into} / ${lv.need} XP to level ${lv.lvl + 1}</div>` + (earned.length ? `<div class="chips" style="margin-top:10px">${earned.slice(-6).reverse().map(x => `<span class="chip">${x.em} ${esc(x.name)}</span>`).join('')}</div>` : '');
  $$('[data-view-go]').forEach(x => x.onclick = () => show(x.dataset.viewGo));
}
function dayList(k) {
  const d = day(k); const ws = allWorkouts().filter(w => w.date === k); const items = [];
  if (d && d.weight != null) items.push(`<li><span class="ico">⚖️</span><div class="t"><b>Weighed in</b><span>${k === todayKey() ? 'this morning' : fmtDate(k)}</span></div><span class="k">${d.weight} lb</span><button class="x" data-del="weight">×</button></li>`);
  if (d && d.waist != null) items.push(`<li><span class="ico">📏</span><div class="t"><b>Waist tape</b><span>at the navel</span></div><span class="k">${d.waist} in</span><button class="x" data-del="waist">×</button></li>`);
  if (d && d.steps != null) items.push(`<li><span class="ico">👟</span><div class="t"><b>Steps</b></div><span class="k">${d.steps.toLocaleString()}</span><button class="x" data-del="steps">×</button></li>`);
  ws.forEach(w => items.push(`<li><span class="ico">🏋️</span><div class="t"><b>${esc(PROGRAM.cards[w.card]?.title || 'Gym')}</b><span>${(w.exercises || []).filter(e => e.done).length} movements${w.prs && w.prs.length ? ' · ' + w.prs.length + ' PR' + (w.prs.length > 1 ? 's' : '') : ''}${w.minutes ? ' · ' + w.minutes + ' min' : ''}</span></div><span class="k">${w.feel || ''}</span><button class="x" data-delw="${w.id}">×</button></li>`));
  (d ? d.activities : []).forEach(a => items.push(`<li><span class="ico">${actIcon(a.type)}</span><div class="t"><b>${esc(actName(a.type))}</b><span>${esc(actSummary(a))}</span></div><button class="x" data-dela="${a.id}">×</button></li>`));
  (d ? d.meals : []).forEach(m => items.push(`<li><span class="ico">${m.treat ? '🍺' : '🍽️'}</span><div class="t"><b>${esc(m.text)}${m.qty > 1 ? ' ×' + m.qty : ''}</b><span>${m.t || ''}</span></div><span class="k">${m.kcal ? (m.verified === false ? '~' : '') + Math.round(m.kcal) + ' kcal' : ''}</span><button class="x" data-delm="${m.id}">×</button></li>`));
  const html = items.length ? `<ul class="list" data-day="${k}">${items.join('')}</ul>` : `<div class="empty">Nothing on the record for this day yet.</div>`;
  setTimeout(() => bindDeletes(k), 0);
  return html;
}
function bindDeletes(k) {
  $$(`ul.list[data-day="${k}"] .x`).forEach(x => x.onclick = () => {
    if (!confirm('Remove this entry?')) return; const d = day(k, true);
    if (x.dataset.del) d[x.dataset.del] = null;
    if (x.dataset.delm) d.meals = d.meals.filter(m => m.id !== x.dataset.delm);
    if (x.dataset.dela) d.activities = d.activities.filter(a => a.id !== x.dataset.dela);
    if (x.dataset.delw) { const m = month(monthOf(k)); delete m.workouts[x.dataset.delw]; touchMonth(monthOf(k)); }
    touchDay(k); render();
  });
}
const ACT_ICONS = { 'rower-intervals': '🚣', 'rower-steady': '🚣', 'incline-walk': '🎒', walk: '🚶', hike: '🥾', swim: '🏊', kayak: '🛶', other: '✨' };
const actIcon = t => ACT_ICONS[t] || '✨';
const actName = t => (PROGRAM.cardio[t] || {}).name || t;
function actSummary(a) { const p = []; if (a.minutes) p.push(a.minutes + ' min'); if (a.miles) p.push(a.miles + ' mi'); if (a.yards) p.push(a.yards + ' yd'); if (a.avgWatts) p.push(a.avgWatts + ' W avg'); if (a.split) p.push(a.split + ' /500m'); if (a.hardPieces) p.push(a.hardPieces + ' hard pieces'); if (a.packLb) p.push(a.packLb + ' lb pack'); if (a.incline) p.push(a.incline + '% incline'); if (a.elevationFt) p.push(a.elevationFt + ' ft up'); if (a.note) p.push(a.note); return p.join(' · '); }

/* quick actions */
$$('.quick button').forEach(b => b.addEventListener('click', () => quick(b.dataset.go)));
function quick(what, k) {
  k = k || todayKey();
  if (what === 'gym') return show('gym');
  if (what === 'weigh') return sheetWeigh(k);
  if (what === 'steps') return sheetSteps(k);
  if (what === 'meal') return sheetMeal(k);
  if (what === 'move') return sheetMove(k);
}
function sheetWeigh(k) {
  const d = day(k) || {}; const last = weightSeries().filter(p => p.k < k).pop(); const isFri = parseKey(k).getDay() === 5;
  openSheet(`<h2>Weigh in · ${fmtDate(k)}</h2><p class="sub">First thing, before breakfast. One number; I coach the average.</p>
    <div class="field"><label>Weight (lb)</label><input class="big" type="number" step="0.1" inputmode="decimal" id="shW" value="${d.weight ?? ''}" placeholder="${last ? last.v : '—'}"></div>
    <div class="field"><label>Waist (in) ${isFri ? '<span class="pill warn">tape day</span>' : '<span class="muted">optional</span>'}</label><input type="number" step="0.25" inputmode="decimal" id="shWaist" value="${d.waist ?? ''}" placeholder="at the navel, two readings averaged"></div>
    <button class="btn block" id="shSave">Save</button>`);
  $('#shSave').onclick = () => { const w = parseFloat($('#shW').value), wa = parseFloat($('#shWaist').value); const dd = day(k, true); const beforeMin = (() => { const ws = weightSeries().filter(p => p.k !== k); const av = avgSeries(ws).map(p => p.v); return av.length ? Math.min(...av) : null; })();
    if (!isNaN(w)) dd.weight = w; if (!isNaN(wa)) dd.waist = wa; if (isNaN(w) && isNaN(wa)) return toast('Give me a number, handsome.'); touchDay(k); closeSheet(); render();
    const a7 = avg7(weightSeries(), k); if (!isNaN(w) && a7 != null && beforeMin != null && a7 < beforeMin && weightSeries().length >= 8) celebrate('New low on the weekly average!', `${r1(a7)} lb — the honest number just moved.`, '📉'); else toast('On the record ✓'); checkBadges(); };
}
function sheetSteps(k) {
  const d = day(k) || {};
  openSheet(`<h2>Steps · ${fmtDate(k)}</h2><p class="sub">Whatever the phone or watch says at the end of the day.</p><div class="field"><input class="big" type="number" inputmode="numeric" id="shS" value="${d.steps ?? ''}" placeholder="8,000"></div><button class="btn block" id="shSave">Save</button>`);
  $('#shSave').onclick = () => { const s = parseInt($('#shS').value, 10); if (isNaN(s)) return toast('A number, please!'); const dd = day(k, true); dd.steps = s; touchDay(k); closeSheet(); render(); if (s >= 10000) celebrate('Ten thousand!', `${s.toLocaleString()} steps today. Those legs have places to be.`, '👟'); else toast('Steps saved ✓'); checkBadges(); };
}
function sheetMove(k, type) {
  type = type || 'walk'; const spec = PROGRAM.cardio[type]; const labels = { minutes: 'Minutes', miles: 'Miles', yards: 'Yards', avgWatts: 'Avg watts (hard pieces)', split: 'Split /500m', hardPieces: 'Hard pieces', packLb: 'Pack (lb)', incline: 'Incline %', elevationFt: 'Elevation (ft)' };
  openSheet(`<h2>Move · ${fmtDate(k)}</h2><div class="field"><label>What</label><select id="mvType">${Object.entries(PROGRAM.cardio).map(([t, s]) => `<option value="${t}" ${t === type ? 'selected' : ''}>${actIcon(t)} ${esc(s.name)}</option>`).join('')}</select>${spec.hint ? `<div class="hint">${esc(spec.hint)}</div>` : ''}</div>
    <div class="fields">${spec.fields.map(f => `<div class="field"><label>${labels[f] || f}</label><input ${f === 'split' ? 'type="text" placeholder="2:05"' : 'type="number" inputmode="decimal" step="any"'} id="mv_${f}"></div>`).join('')}</div>
    <div class="field"><label>Note</label><input id="mvNote" placeholder="how it went"></div><button class="btn block" id="shSave">Save</button>`);
  $('#mvType').onchange = e => sheetMove(k, e.target.value);
  $('#shSave').onclick = () => { const a = { id: uid(), type, t: timeNow() }; spec.fields.forEach(f => { const v = $('#mv_' + f).value.trim(); if (v) a[f] = f === 'split' ? v : parseFloat(v); }); a.note = $('#mvNote').value.trim(); if (!a.minutes && !a.miles && !a.yards && !a.note) return toast('Minutes or a note — something for the record.'); const dd = day(k, true); dd.activities.push(a); touchDay(k); closeSheet(); render(); toast(`${actName(type)} banked ✓`); checkBadges(); };
}
/* meals */
function foodCounts() { const c = {}; allDays().forEach(([k, d]) => (d.meals || []).forEach(m => { if (m.foodId) c[m.foodId] = (c[m.foodId] || 0) + 1; })); return c; }
function findFood(id) { return FOODS.find(f => f.id === id); }
function searchFoods(q) { q = q.trim().toLowerCase(); if (!q) return []; return FOODS.filter(f => f.name.toLowerCase().includes(q) || (f.aliases || []).some(a => a.toLowerCase().includes(q)) || f.id.includes(q)).slice(0, 12); }
function sheetMeal(k) {
  const counts = foodCounts(); const defaults = ['protein-shake', 'berries', 'beef-jerky', 'greek-yogurt', 'steak', 'chicken-breast', 'cheddar', 'crackers', 'beer', 'ice-cream'];
  const freq = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id]) => id).filter(findFood).slice(0, 10);
  const chips = (freq.length >= 4 ? freq : Array.from(new Set([...freq, ...defaults.filter(findFood), ...FOODS.map(f => f.id)])).slice(0, 10));
  openSheet(`<h2>Plate · ${fmtDate(k)}</h2><p class="sub">Tap what you ate; type anything else. Calories are estimates for a normal serving — ~ means unverified.</p>
    <div class="field search"><input id="mlQ" placeholder="Search the library… (burger, shake, beer)" autocomplete="off"><div class="results hide" id="mlRes"></div></div>
    <div class="chips" id="mlChips">${chips.map(id => { const f = findFood(id); return `<button class="chip ${f.treat ? 'treat' : ''}" data-food="${f.id}">${esc(f.name.split(' (')[0])}<span class="k">${f.verified === false ? '~' : ''}${f.kcal}</span></button>`; }).join('')}</div>
    <details style="margin-top:12px"><summary>Something not in the library</summary><div class="fields" style="margin-top:8px"><div class="field"><label>What</label><input id="mlText" placeholder="lobster roll"></div><div class="field"><label>Calories (optional)</label><input id="mlK" type="number" inputmode="numeric" placeholder="~"></div></div><div class="row"><label class="row small"><input type="checkbox" id="mlTreat"> counts as a treat</label><button class="btn sm" id="mlAddCustom">Add</button></div></details>
    <div id="mlToday" style="margin-top:12px"></div>`);
  const renderToday = () => { const d = day(k); $('#mlToday').innerHTML = d && d.meals.length ? `<h3>On today's plate · ~${Math.round(kcalOf(d))} kcal</h3>` + dayList(k) : ''; };
  renderToday();
  const add = (food, qty = 1) => { const dd = day(k, true); const ex = dd.meals.find(m => m.foodId === food.id && m.t && Math.abs(Date.now() - new Date().setHours(...m.t.split(':').map(Number), 0, 0)) < 3600000); if (ex) { ex.qty = (ex.qty || 1) + 1; ex.kcal = food.kcal * ex.qty; } else dd.meals.push({ id: uid(), t: timeNow(), text: food.name.split(' (')[0], foodId: food.id, qty, kcal: food.kcal * qty, treat: !!food.treat, verified: food.verified !== false }); touchDay(k); renderToday(); renderHomeIfVisible(); toast(`${food.name.split(' (')[0]} added${food.treat ? ' · treat meter +1' : ''}`); if (food.treat) { const f = facts(); if (f.budget != null && f.treats === f.budget + 1) toast('Treat meter is over the line this week. The trend will referee.'); } };
  $$('#mlChips .chip').forEach(c => c.onclick = () => add(findFood(c.dataset.food)));
  const q = $('#mlQ'), res = $('#mlRes');
  q.oninput = () => { const hits = searchFoods(q.value); res.classList.toggle('hide', !hits.length); res.innerHTML = hits.map(f => `<button data-food="${f.id}"><span class="n">${esc(f.name)}</span><span class="k">${f.verified === false ? '~' : ''}${f.kcal} kcal</span></button>`).join(''); $$('button', res).forEach(b => b.onclick = () => { add(findFood(b.dataset.food)); q.value = ''; res.classList.add('hide'); }); if (hits.length === 0 && q.value.trim()) { $('#mlText').value = q.value.trim(); $('details', $('#sheetBody')).open = true; } };
  $('#mlAddCustom').onclick = () => { const text = $('#mlText').value.trim(); if (!text) return toast('Name it, at least.'); const kc = parseInt($('#mlK').value, 10); const dd = day(k, true); dd.meals.push({ id: uid(), t: timeNow(), text, foodId: null, qty: 1, kcal: isNaN(kc) ? 0 : kc, treat: $('#mlTreat').checked, verified: false }); touchDay(k); $('#mlText').value = ''; $('#mlK').value = ''; renderToday(); renderHomeIfVisible(); toast(text + ' added'); };
}
function renderHomeIfVisible() { if ($('#view-home').classList.contains('active')) renderHome(); if ($('#view-log').classList.contains('active')) renderLog(); }

/* ---------- LOG (any day) ---------- */
let logKey = todayKey();
$('#logDate').addEventListener('change', e => { if (e.target.value) { logKey = e.target.value; renderLog(); } });
$('#datePrev').onclick = () => { logKey = addDays(logKey, -1); renderLog(); };
$('#dateNext').onclick = () => { logKey = addDays(logKey, 1); renderLog(); };
$('#dateToday').onclick = () => { logKey = todayKey(); renderLog(); };
let noteT = null; $('#dayNote').addEventListener('input', e => { clearTimeout(noteT); noteT = setTimeout(() => { const d = day(logKey, true); d.note = e.target.value; touchDay(logKey); }, 500); });
function renderLog() {
  const k = logKey; $('#logDate').value = k; const d = day(k) || {};
  $('#logBody').innerHTML = `<h2>${fmtDate(k)}${k === todayKey() ? ' · today' : ''}</h2><div class="fields">
    <div class="field"><label>Weight (lb)</label><input type="number" step="0.1" inputmode="decimal" id="lgW" value="${d.weight ?? ''}"></div>
    <div class="field"><label>Waist (in)</label><input type="number" step="0.25" inputmode="decimal" id="lgWa" value="${d.waist ?? ''}"></div>
    <div class="field"><label>Steps</label><input type="number" inputmode="numeric" id="lgS" value="${d.steps ?? ''}"></div></div>`;
  const save = () => { const dd = day(k, true); const w = parseFloat($('#lgW').value), wa = parseFloat($('#lgWa').value), s = parseInt($('#lgS').value, 10); dd.weight = isNaN(w) ? null : w; dd.waist = isNaN(wa) ? null : wa; dd.steps = isNaN(s) ? null : s; touchDay(k); setSyncUI(); checkBadges(); };
  ['#lgW', '#lgWa', '#lgS'].forEach(s => $(s).onchange = save);
  $('#logMeals').innerHTML = `<div class="row spread"><h2>Plates ${d.meals && d.meals.length ? `<span class="pill">~${Math.round(kcalOf(d))} kcal</span>` : ''}</h2><button class="btn sm" id="lgAddMeal">+ Add</button></div>` + (d.meals && d.meals.length ? dayListFiltered(k, 'meals') : '<div class="empty">No plates logged.</div>');
  $('#lgAddMeal').onclick = () => sheetMeal(k);
  $('#logMoves').innerHTML = `<div class="row spread"><h2>Moves</h2><div class="row"><button class="btn sm ghost" id="lgGym">Gym</button><button class="btn sm" id="lgAddMove">+ Add</button></div></div>` + dayListFiltered(k, 'moves');
  $('#lgAddMove').onclick = () => sheetMove(k); $('#lgGym').onclick = () => show('gym');
  $('#dayNote').value = d.note || '';
}
function dayListFiltered(k, which) { const html = dayList(k); const tmp = document.createElement('div'); tmp.innerHTML = html; const ul = tmp.querySelector('ul'); if (!ul) return which === 'moves' ? '<div class="empty">No moves logged.</div>' : ''; $$('li', ul).forEach(li => { const isMeal = li.querySelector('[data-delm]'); const isMove = li.querySelector('[data-dela],[data-delw]'); if (which === 'meals' && !isMeal) li.remove(); if (which === 'moves' && !isMove) li.remove(); }); if (!ul.children.length) return which === 'moves' ? '<div class="empty">No moves logged.</div>' : ''; ul.dataset.day = k; return tmp.innerHTML; }

/* ---------- GYM ---------- */
function renderGym() {
  if (state.live) { $('#gymHome').classList.add('hide'); $('#gymLive').classList.remove('hide'); renderLive(); return; }
  $('#gymHome').classList.remove('hide'); $('#gymLive').classList.add('hide');
  const ws = allWorkouts().slice().reverse(); const lastA = ws.find(w => w.card === 'A'), lastB = ws.find(w => w.card === 'B');
  const next = !lastA && !lastB ? null : (!lastA ? 'A' : !lastB ? 'B' : (lastA.date > lastB.date ? 'B' : 'A'));
  $('#gymHome').innerHTML = `
    <div class="card"><h2>Start a session</h2><p class="sub">${next ? `Next up by rotation: Gym ${next}.` : 'Either letter — the rotation starts wherever you do.'} Loads prefill from your last session.</p>
      <div class="row"><button class="btn block start ${next === 'B' ? 'ghost' : ''}" data-start="A">🅰️ Gym A<span class="tiny" style="font-weight:600">${esc(PROGRAM.cards.A.subtitle)}</span></button><button class="btn block start ${next === 'A' ? 'ghost' : ''}" data-start="B">🅱️ Gym B<span class="tiny" style="font-weight:600">${esc(PROGRAM.cards.B.subtitle)}</span></button></div></div>
    <div class="card"><h2>Recent sessions</h2>${ws.length ? `<ul class="list">${ws.slice(0, 8).map(w => `<li><span class="ico">${w.card === 'A' ? '🅰️' : '🅱️'}</span><div class="t"><b>${fmtDate(w.date)}</b><span>${(w.exercises || []).filter(e => e.done).length}/${(w.exercises || []).length} movements${w.minutes ? ' · ' + w.minutes + ' min' : ''}${w.feel ? ' · felt ' + esc(w.feel) : ''}</span></div>${w.prs && w.prs.length ? `<span class="pill warn">${w.prs.length} PR</span>` : ''}</li>`).join('')}</ul>` : '<div class="empty">No sessions on the record yet. The first one is the baseline — no numbers to beat, just numbers to write down.</div>'}</div>
    <div class="card"><details><summary>The safety contract</summary><ol class="small" style="padding-left:18px;margin:8px 0 0">${PROGRAM.rules.map(r => `<li style="margin-bottom:6px">${esc(r)}</li>`).join('')}</ol><p class="tiny muted">Program ${esc(PROGRAM.version)}. Changes to the program itself are Lexi's and the Captain's — this card only follows it.</p></details></div>`;
  $$('[data-start]').forEach(b => b.onclick = () => startLive(b.dataset.start));
}
function startLive(card) {
  const c = PROGRAM.cards[card];
  state.live = { id: 'w_' + uid(), card, date: todayKey(), start: nowISO(), warmup: false, cooldown: false, exercises: c.exercises.map(e => { const last = lastSetsFor(e.key); return { key: e.key, done: false, open: false, sets: Array.from({ length: e.sets }, (_, i) => ({ wt: last && last.sets[i] ? last.sets[i].wt : null, reps: last && last.sets[i] ? last.sets[i].reps : null })), lastDate: last ? last.date : null }; }) };
  persist(); renderGym();
}
let liveTimer = null;
function renderLive() {
  const L = state.live; clearInterval(liveTimer); liveTimer = setInterval(() => { if (!state.live || !$('#view-gym').classList.contains('active')) return clearInterval(liveTimer); const p = $('#gymLive .pill'); if (p) p.textContent = Math.round((Date.now() - new Date(state.live.start)) / 60000) + ' min'; }, 30000); const c = PROGRAM.cards[L.card]; const mins = Math.round((Date.now() - new Date(L.start)) / 60000);
  $('#gymLive').innerHTML = `<div class="card"><div class="row spread"><h2>${c.title} · live</h2><span class="pill">${mins} min</span></div><p class="sub">${esc(c.subtitle)}. Tap the name for the cue, the circle when it's done.</p>
    <label class="bookend"><input type="checkbox" id="lvWarm" ${L.warmup ? 'checked' : ''}> ${esc(PROGRAM.bookends.warmup)}</label>
    <div id="lvEx">${L.exercises.map((e, i) => exHtml(e, c.exercises[i], i)).join('')}</div>
    <label class="bookend"><input type="checkbox" id="lvCool" ${L.cooldown ? 'checked' : ''}> ${esc(PROGRAM.bookends.cooldown)}</label>
    <div class="row" style="margin-top:12px"><button class="btn neon block" id="lvFinish">Finish session</button><button class="btn ghost" id="lvDiscard">Discard</button></div></div>`;
  $('#lvWarm').onchange = e => { L.warmup = e.target.checked; persist(); }; $('#lvCool').onchange = e => { L.cooldown = e.target.checked; persist(); };
  $$('#lvEx .ex').forEach((el, i) => {
    const e = L.exercises[i];
    $('.check', el).onclick = () => { e.done = !e.done; persist(); renderLive(); };
    $('.name', el).onclick = () => { e.open = !e.open; persist(); el.classList.toggle('open', e.open); };
    $$('input', el).forEach(inp => inp.onchange = () => { const s = e.sets[Number(inp.dataset.set)]; const v = parseFloat(inp.value); s[inp.dataset.f] = isNaN(v) ? null : v; persist(); });
  });
  $('#lvFinish').onclick = finishLive; $('#lvDiscard').onclick = () => { if (confirm('Discard this session? Nothing is saved.')) { state.live = null; persist(); renderGym(); } };
}
function exHtml(e, spec, i) {
  const best = bestForExercise(spec.key, state.live && state.live.id); const lastTxt = e.lastDate ? `last ${fmtShort(e.lastDate)}` : esc(spec.startHint);
  const units = spec.unit.replace('lb/hand', 'lb/hand'); const wtLabel = spec.kind === 'timed' ? (spec.unit === 'sec' ? 'sec' : 'reps') : units;
  return `<div class="ex ${e.done ? 'done' : ''} ${e.open ? 'open' : ''}" data-i="${i}"><div class="head"><button class="check">${e.done ? '✓' : ''}</button><div class="name">${esc(spec.name)}<small>${spec.sets} × ${esc(spec.reps)} · ${lastTxt}${best ? ` · best ${best.wt}${spec.kind === 'timed' ? '' : ' ' + units.split('/')[0]}` : ''}</small></div></div>
    <div class="sets">${e.sets.map((s, j) => `<div class="set"><label>Set ${j + 1}</label><div class="pair"><input type="number" inputmode="decimal" step="any" placeholder="${spec.kind === 'timed' ? wtLabel : 'load'}" value="${s.wt ?? ''}" data-set="${j}" data-f="wt"><span class="x">×</span><input type="number" inputmode="numeric" placeholder="reps" value="${s.reps ?? ''}" data-set="${j}" data-f="reps"></div><span class="u">${esc(wtLabel)}</span></div>`).join('')}</div>
    <div class="cue">💡 ${esc(spec.cue)}</div></div>`;
}
function finishLive() {
  const L = state.live; const done = L.exercises.filter(e => e.done).length;
  openSheet(`<h2>How did it feel?</h2><p class="sub">${done} of ${L.exercises.length} movements ticked.</p><div class="chips" id="feelChips">${['easy', 'right', 'hard'].map(f => `<button class="chip neutral" data-feel="${f}">${f === 'easy' ? '😌 easy' : f === 'right' ? '😎 just right' : '🥵 hard'}</button>`).join('')}</div>
    <div class="field" style="margin-top:12px"><label>Note (RDLs — back quiet?)</label><input id="fnNote" placeholder="anything Lexi should know"></div><button class="btn block" id="fnSave">Save session</button>`);
  let feel = null; $$('#feelChips .chip').forEach(c => c.onclick = () => { feel = c.dataset.feel; $$('#feelChips .chip').forEach(x => x.classList.toggle('on', x === c)); });
  $('#fnSave').onclick = () => {
    const prs = [];
    L.exercises.forEach(e => { const spec = PROGRAM.cards[L.card].exercises.find(x => x.key === e.key); if (spec.kind === 'timed') return; const best = bestForExercise(e.key, L.id); let top = null; e.sets.forEach(s => { if (s.wt == null) return; if (!top || s.wt > top.wt || (s.wt === top.wt && (s.reps || 0) > (top.reps || 0))) top = s; }); if (top && best && (top.wt > best.wt || (top.wt === best.wt && (top.reps || 0) > (best.reps || 0)))) prs.push({ key: e.key, name: spec.name, wt: top.wt, reps: top.reps, prevWt: best.wt, prevReps: best.reps }); });
    const w = { id: L.id, card: L.card, date: L.date, start: L.start, end: nowISO(), minutes: Math.max(1, Math.round((Date.now() - new Date(L.start)) / 60000)), warmup: L.warmup, cooldown: L.cooldown, feel, note: $('#fnNote').value.trim(), exercises: L.exercises.map(e => ({ key: e.key, done: e.done, sets: e.sets.filter(s => s.wt != null || s.reps != null) })), prs, updatedAt: nowISO() };
    const m = month(monthOf(w.date), true); m.workouts[w.id] = w; state.prCount = (state.prCount || 0) + prs.length; state.live = null; touchMonth(monthOf(w.date)); touchDay(w.date); closeSheet(); renderGym(); render();
    if (prs.length) prs.forEach(p => celebrate(`PR: ${p.name}`, `${p.wt} × ${p.reps || '?'} — up from ${p.prevWt} × ${p.prevReps || '?'}. Earned, not flattered.`, '🏋️')); else toast(`Session saved · ${w.minutes} min ✓`);
    checkBadges();
  };
}

/* ---------- TRENDS ---------- */
let trendTab = 'weight', trendRange = 90, liftKey = 'leg-press';
$$('#trendTabs button').forEach(b => b.onclick = () => { trendTab = b.dataset.t; $$('#trendTabs button').forEach(x => x.classList.toggle('on', x === b)); renderTrends(); });
function svgChart({ series = [], avg = [], bars = [], bars2 = [], band = null, ref = null, pace = null, yFmt = v => v, height = 220, days = null, yMin = null, yMax = null }) {
  const W = Math.max(300, (($('#trendBody') && $('#trendBody').clientWidth) || 360) - 34), H = height, P = { l: 40, r: 12, t: 12, b: 26 }; const all = [...series, ...avg, ...bars, ...bars2, ...(pace || [])].filter(p => p.v != null);
  if (!all.length) return `<div class="empty">Nothing to draw yet — a few entries and this comes alive.</div>`;
  const ks = all.map(p => p.k).sort(); let k0 = ks[0], k1 = ks[ks.length - 1]; if (days) k0 = addDays(k1, -(days - 1)); if (pace && pace.length) k1 = pace[pace.length - 1].k > k1 ? pace[pace.length - 1].k : k1; if (k0 === k1) k0 = addDays(k1, -6);
  const span = Math.max(1, dayDiff(k0, k1)); const x = k => P.l + (dayDiff(k0, k) / span) * (W - P.l - P.r);
  const vals = all.filter(p => p.k >= k0).map(p => p.v); let lo = yMin != null ? yMin : Math.min(...vals), hi = yMax != null ? yMax : Math.max(...vals); if (band) { lo = Math.min(lo, band[0]); hi = Math.max(hi, band[1]); } if (ref != null) { lo = Math.min(lo, ref); hi = Math.max(hi, ref); } if (bars.length && yMin == null) lo = 0; if (hi - lo < 2) { hi += 1; lo -= 1; } const pad = (hi - lo) * .08; lo -= pad; hi += pad;
  const y = v => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  const ticks = 4; for (let i = 0; i <= ticks; i++) { const v = lo + (hi - lo) * i / ticks; s += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${P.l - 6}" y="${y(v) + 3}" text-anchor="end">${yFmt(r1(v))}</text>`; }
  const nx = Math.min(6, span); for (let i = 0; i <= nx; i++) { const k = addDays(k0, Math.round(span * i / nx)); s += `<text class="axis" x="${x(k)}" y="${H - 8}" text-anchor="middle">${fmtShort(k)}</text>`; }
  if (band) s += `<rect class="goal" x="${P.l}" width="${W - P.l - P.r}" y="${y(band[1])}" height="${Math.max(2, y(band[0]) - y(band[1]))}" rx="4"/>`;
  if (ref != null) s += `<line class="ref" x1="${P.l}" x2="${W - P.r}" y1="${y(ref)}" y2="${y(ref)}"/>`;
  const bw = Math.max(3, (W - P.l - P.r) / (span + 1) * .7);
  bars.filter(p => p.k >= k0).forEach(p => s += `<rect class="bar" x="${x(p.k) - bw / 2}" width="${bw}" y="${y(p.v)}" height="${Math.max(0, y(lo + pad) - y(p.v))}" rx="3"/>`);
  bars2.filter(p => p.k >= k0).forEach(p => s += `<rect class="bar treat" x="${x(p.k) - bw / 2}" width="${bw}" y="${y(p.v)}" height="${Math.max(0, y(lo + pad) - y(p.v))}" rx="3"/>`);
  if (pace && pace.length === 2) s += `<line class="ref" style="stroke:var(--violet)" x1="${x(pace[0].k)}" y1="${y(pace[0].v)}" x2="${x(pace[1].k)}" y2="${y(pace[1].v)}"/>`;
  series.filter(p => p.k >= k0 && p.v != null).forEach(p => s += `<circle class="pts" cx="${x(p.k)}" cy="${y(p.v)}" r="3.5"/>`);
  const av = avg.filter(p => p.k >= k0 && p.v != null); if (av.length > 1) s += `<path class="avg" d="${av.map((p, i) => (i ? 'L' : 'M') + x(p.k) + ' ' + y(p.v)).join(' ')}"/>`;
  else if (av.length === 1) s += `<circle cx="${x(av[0].k)}" cy="${y(av[0].v)}" r="5" fill="var(--pink-deep)"/>`;
  return s + '</svg>';
}
function renderTrends() {
  const f = facts(); const g = state.settings.goal; let html = '';
  const rangeBtns = `<div class="tabs" style="max-width:260px">${[30, 90, 0].map(r => `<button data-r="${r}" class="${trendRange === r ? 'on' : ''}">${r ? r + 'd' : 'all'}</button>`).join('')}</div>`;
  if (trendTab === 'weight') {
    let pace = null; if (g.date && f.ws.length) { const first = f.ws[0]; const target = (Number(g.low) + Number(g.high)) / 2; if (g.date > first.k) pace = [{ k: first.k, v: first.v }, { k: g.date, v: target }]; }
    const lastAvg = f.a7; const toGo = lastAvg != null && g.high ? r1(lastAvg - g.high) : null;
    html = `<div class="card">${rangeBtns}<h2>Weight</h2><p class="sub">Dots are mornings. The line is the 7-day average — the one we coach.${toGo != null ? ` ${toGo > 0 ? toGo + ' lb above the top of the band' : 'inside the band'}.` : ''}</p>${svgChart({ series: f.ws, avg: f.avgs, band: g.low && g.high ? [Number(g.low), Number(g.high)] : null, pace, days: trendRange || null, yFmt: v => v })}<div class="legend"><span><i style="background:var(--pink);opacity:.55"></i>weigh-in</span><span><i style="background:var(--pink-deep)"></i>7-day avg</span>${g.low ? '<span><i style="background:var(--neon);opacity:.4"></i>goal band</span>' : ''}${pace ? '<span><i style="background:var(--violet)"></i>pace to your date</span>' : ''}</div></div>` + weeklyTable(f);
  } else if (trendTab === 'waist') {
    const w = f.waist; const last = w[w.length - 1], prev = w[w.length - 2];
    html = `<div class="card">${rangeBtns}<h2>Waist</h2><p class="sub">Friday mornings, at the navel. The better scoreboard for the real goal.${last && prev ? ` Last ${last.v} in, ${r1(last.v - prev.v) <= 0 ? 'down' : 'up'} ${Math.abs(r1(last.v - prev.v))} on the reading before.` : ''}</p>${svgChart({ series: w, avg: w, ref: g.waist ? Number(g.waist) : null, days: trendRange || null })}</div>`;
  } else if (trendTab === 'food') {
    const days = allDays(); const k1 = todayKey(); const k0 = addDays(k1, -(trendRange || 365)); const bars = [], treat = []; const counts = {};
    for (let k = k0; k <= k1; k = addDays(k, 1)) { const d = day(k); if (!d) continue; const kc = kcalOf(d); if (kc) bars.push({ k, v: kc }); const tk = (d.meals || []).filter(m => m.treat).reduce((s, m) => s + (m.kcal || 0), 0); if (tk) treat.push({ k, v: tk }); (d.meals || []).forEach(m => { counts[m.text] = (counts[m.text] || 0) + (m.qty || 1); }); }
    const logged = bars.map(b => b.v); const avgK = logged.length ? Math.round(mean(logged)) : null; const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
    html = `<div class="card">${rangeBtns}<h2>Plates</h2><p class="sub">Estimated calories per logged day${avgK ? ` · averaging ~${avgK.toLocaleString()} on days you logged` : ''}. Yellow is the treat share.</p>${svgChart({ bars, bars2: treat, days: Math.min(trendRange || 60, 60), yMin: 0 })}<div class="legend"><span><i style="background:var(--pink)"></i>all plates</span><span><i style="background:var(--lemon)"></i>treats</span></div></div>
      <div class="card"><h2>What you actually eat</h2>${top.length ? `<div class="chips">${top.map(([n, c]) => `<span class="chip neutral">${esc(n)}<span class="k">×${c}</span></span>`).join('')}</div>` : '<div class="empty">Log a few plates and the pattern shows itself.</div>'}</div>`;
  } else if (trendTab === 'steps') {
    const bars = allDays().filter(([k, d]) => d.steps != null).map(([k, d]) => ({ k, v: d.steps })); const last7 = bars.slice(-7).map(b => b.v);
    html = `<div class="card">${rangeBtns}<h2>Steps</h2><p class="sub">${last7.length ? `Last ${last7.length} logged days average ${Math.round(mean(last7)).toLocaleString()}.` : 'Typed in once a day.'} Dashed line is 10,000.</p>${svgChart({ bars, ref: 10000, days: Math.min(trendRange || 60, 60), yMin: 0, yFmt: v => Math.round(v / 1000) + 'k' })}</div>`;
  } else if (trendTab === 'lifts') {
    const keys = []; Object.values(PROGRAM.cards).forEach(c => c.exercises.forEach(e => { if (e.kind !== 'timed') keys.push(e); }));
    const pts = []; allWorkouts().forEach(w => (w.exercises || []).forEach(e => { if (e.key !== liftKey) return; let top = null; (e.sets || []).forEach(s => { if (s.wt != null && (!top || s.wt > top)) top = s.wt; }); if (top != null) pts.push({ k: w.date, v: top }); }));
    const spec = keys.find(e => e.key === liftKey); const best = bestForExercise(liftKey);
    html = `<div class="card"><div class="field"><label>Movement</label><select id="liftSel">${keys.map(e => `<option value="${e.key}" ${e.key === liftKey ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div><h2>${esc(spec.name)}</h2><p class="sub">Top set per session${best ? ` · best ${best.wt} ${spec.unit.split('/')[0]} × ${best.reps || '?'} on ${fmtShort(best.date)}` : ''}. Progress is measured across weeks, never one session's feelings.</p>${svgChart({ series: pts, avg: pts, days: trendRange || null })}</div>`;
  }
  $('#trendBody').innerHTML = html;
  $$('#trendBody [data-r]').forEach(b => b.onclick = () => { trendRange = Number(b.dataset.r); renderTrends(); });
  const sel = $('#liftSel'); if (sel) sel.onchange = e => { liftKey = e.target.value; renderTrends(); };
}
function weeklyTable(f) {
  if (f.ws.length < 2) return ''; const rows = []; let k = f.ws[f.ws.length - 1].k; for (let i = 0; i < 8; i++) { const [a, b] = weekBounds(k); const vals = f.ws.filter(p => p.k >= a && p.k <= b).map(p => p.v); if (vals.length) rows.push({ a, b, avg: r1(mean(vals)), n: vals.length }); k = addDays(a, -1); if (k < f.ws[0].k) break; }
  return `<div class="card"><h2>Week by week</h2><table style="width:100%;border-collapse:collapse;font-size:.9rem">${rows.map((r, i) => { const prev = rows[i + 1]; const d = prev ? r1(r.avg - prev.avg) : null; return `<tr style="border-bottom:1px solid var(--line)"><td style="padding:6px 0">${fmtShort(r.a)} – ${fmtShort(r.b)}</td><td class="right"><b>${r.avg}</b> <span class="muted tiny">(${r.n})</span></td><td class="right" style="color:${d == null ? 'var(--muted)' : d <= -0.5 ? 'var(--ok)' : d >= 0.5 ? 'var(--warn)' : 'var(--muted)'};font-weight:800">${d == null ? '' : (d > 0 ? '+' : '') + d}</td></tr>`; }).join('')}</table><p class="tiny muted">Average of the week's weigh-ins (count in grey). Inside ±0.5 is noise, not a ruling.</p></div>`;
}

/* ---------- ME ---------- */
function renderMe() {
  const f = facts(); const xp = xpTotal(); const lv = levelFor(xp); const earned = earnedBadges(f).map(b => b.id);
  $('#levelCard').innerHTML = `<div class="level"><div class="num">${lv.lvl}</div><div class="grow"><h2>${lv.name}</h2><div class="small muted">${xp.toLocaleString()} XP · ${lv.need - lv.into} to level ${lv.lvl + 1}</div><div class="xp" style="margin-top:6px"><i style="width:${Math.round(lv.into / lv.need * 100)}%"></i></div></div></div><p class="tiny muted" style="margin-top:10px">XP comes from showing up: weigh-in 10 · plates 10 · steps 5 · tape 15 · a move 20 · a gym session 40 · a PR 25. Never from the number on the scale.</p>`;
  const t = todayKey(); const cells = []; for (let i = 13; i >= 0; i--) { const k = addDays(t, -i); cells.push(`<i class="${dayHasEntry(day(k), k) ? 'on' : ''} ${k === t ? 'today' : ''}" title="${k}"></i>`); }
  $('#streakCard').innerHTML = `<div class="row spread"><h2>Streak</h2><span class="pill neon">${f.streak.current} day${f.streak.current === 1 ? '' : 's'} · best ${f.streak.best}</span></div><div class="streak">${cells.join('')}</div><p class="tiny muted" style="margin-top:6px">Last 14 days; any entry counts. Logging = losing — your own record says so.</p>`;
  $('#badgeGrid').innerHTML = BADGES.map(b => `<div class="badge ${earned.includes(b.id) ? 'on' : ''}"><div class="em">${b.em}</div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span></div>`).join('');
}

/* ---------- SETTINGS ---------- */
function renderSettings() {
  const s = state.settings, y = state.sync; $('#setToken').value = y.token || ''; $('#setRepo').value = y.repo; $('#setPath').value = y.path;
  $('#goalLow').value = s.goal.low ?? ''; $('#goalHigh').value = s.goal.high ?? ''; $('#goalDate').value = s.goal.date || ''; $('#goalWaist').value = s.goal.waist ?? '';
  $('#treatBudget').value = s.treatBudget ?? ''; $('#weekStart').value = String(s.weekStart ?? 1); $('#setCelebrate').checked = !!s.celebrate; $('#setTheme').value = s.theme || 'auto';
  const nd = allDays().filter(([k, d]) => dayHasEntry(d, k)).length; $('#dataStats').textContent = `${nd} logged day${nd === 1 ? '' : 's'}, ${allWorkouts().length} gym session${allWorkouts().length === 1 ? '' : 's'}, ${Object.keys(state.months).length} month file${Object.keys(state.months).length === 1 ? '' : 's'} on this device.`;
  $('#versionLine').textContent = `Lexi's Studio v${APP_VERSION} · program ${PROGRAM.version} · ${FOODS.length} foods in the library`; setSyncUI();
}
function bindSettings() {
  $('#setToken').onchange = e => { state.sync.token = e.target.value.trim(); state.sync.lastError = null; persist(); setSyncUI(); if (state.sync.token) syncAll(true); };
  $('#setRepo').onchange = e => { state.sync.repo = e.target.value.trim(); state.sync.shas = {}; persist(); };
  $('#setPath').onchange = e => { state.sync.path = e.target.value.trim().replace(/^\/|\/$/g, ''); state.sync.shas = {}; persist(); };
  $('#btnSync').onclick = () => { if (!state.sync.token) return toast('Paste a token first.'); Object.keys(state.months).forEach(mk => state.sync.dirty[mk] = true); state.sync.settingsDirty = true; syncAll(true); };
  $('#btnTestToken').onclick = async () => { if (!state.sync.token) return toast('Paste a token first.'); try { const r = await fetch(`https://api.github.com/repos/${state.sync.repo}`, { headers: ghHeaders() }); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); toast(j.permissions && j.permissions.push ? `Token works: ${j.full_name}, ${j.private ? 'private' : 'PUBLIC!'}, can write ✓` : 'Token can read but not write — check Contents: Read and write.'); } catch (e) { toast('Token test failed: ' + e.message); } };
  const g = () => state.settings.goal;
  $('#goalLow').onchange = e => { g().low = parseFloat(e.target.value) || null; touchSettings(); }; $('#goalHigh').onchange = e => { g().high = parseFloat(e.target.value) || null; touchSettings(); };
  $('#goalDate').onchange = e => { g().date = e.target.value || null; touchSettings(); }; $('#goalWaist').onchange = e => { g().waist = parseFloat(e.target.value) || null; touchSettings(); };
  $('#treatBudget').onchange = e => { const v = parseInt(e.target.value, 10); state.settings.treatBudget = isNaN(v) ? null : v; touchSettings(); };
  $('#weekStart').onchange = e => { state.settings.weekStart = Number(e.target.value); touchSettings(); };
  $('#setCelebrate').onchange = e => { state.settings.celebrate = e.target.checked; touchSettings(); if (e.target.checked) celebrate('Celebrations on', 'Every PR and new low gets the confetti it earned.', '🎊'); };
  $('#setTheme').onchange = e => { state.settings.theme = e.target.value; touchSettings(); applyTheme(); };
  $('#btnExport').onclick = () => { const blob = new Blob([JSON.stringify({ exportedAt: nowISO(), months: state.months, settings: state.settings }, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `lexis-studio-${todayKey()}.json`; a.click(); };
  $('#fileImport').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); Object.entries(j.months || {}).forEach(([mk, m]) => { state.months[mk] = mergeMonth(state.months[mk], m); state.sync.dirty[mk] = true; }); if (j.settings && (!state.settings.updatedAt || (j.settings.updatedAt || '') > state.settings.updatedAt)) { state.settings = Object.assign(defaults().settings, j.settings); state.sync.settingsDirty = true; } persist(); scheduleSync(); render(); toast('Imported and merged ✓'); } catch (err) { toast('Could not import: ' + err.message); } };
  $('#btnWipe').onclick = () => { if (!confirm('Clear everything on this device? Your vault in the repo is untouched; sync brings it back.')) return; const keep = state.sync; state = defaults(); state.sync = Object.assign(defaults().sync, { token: keep.token, repo: keep.repo, path: keep.path }); persist(); render(); toast('Device cleared.'); };
  $('#syncStatus').onclick = () => show('settings');
}

/* ---------- render + init ---------- */
function render() {
  const v = $$('.view').find(x => x.classList.contains('active')).id.replace('view-', '');
  if (v === 'home') renderHome(); if (v === 'log') renderLog(); if (v === 'gym') renderGym(); if (v === 'trends') renderTrends(); if (v === 'me') renderMe(); if (v === 'settings') renderSettings();
  setSyncUI();
}
async function init() {
  load(); applyTheme();
  const [p, f] = await Promise.all([fetch('program.json').then(r => r.json()), fetch('foods.json').then(r => r.json()).catch(() => [])]);
  PROGRAM = p; FOODS = f; bindSettings();
  show(state.live ? 'gym' : 'home'); checkBadges();
  window.addEventListener('online', () => { setSyncUI(); scheduleSync(); }); window.addEventListener('offline', setSyncUI);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (state.sync.token) syncAll(); render(); } });
  if (state.sync.token) syncAll();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
}
init();
