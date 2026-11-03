// Builds app/public/arena/data.json for the static /arena replay page (B22)
// from an arena run directory (scripts/arena.mjs output, gitignored). The
// page makes no model calls: every number and line it shows comes from here.
// Usage: node scripts/build-arena.mjs <arenaDir> [--pick id,id,...] [--after <dir>]
//   --pick   featured matches (default: picked by the rules below)
//   --after  a later run (e.g. a B19 replay) whose totals are shown beside
//   --edge   edge-case run dirs (comma, B25): per-family pass rates + featured
//            non-scam matches (expected behaviour vs what KRAI-A did)
//   --rerun  dirs (comma) of re-runs on the fixed code: a featured match that
//            was replayed there shows its after-fix outcome too
//   --regional  B27: <after>[,<before>] regional run dirs (English, Mandarin,
//            probe languages): per-language expected-vs-got table, the
//            "caller did not understand" count, featured regional matches
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notUnderstoodAfterReply, readCalls, summarize } from './arena.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app', 'public', 'arena', 'data.json');

const TIER = { SCAM: 'block', LEGIT: 'allow', UNSURE: 'escalate' };

// One turn -> the chips the page shows (all from the recorded pipeline output).
export function turnView(t) {
  const r = t.rx || {};
  const chips = [];
  if (r.t1) chips.push({ k: 't1', tier: 'block', text: `T1 ${r.t1}` });
  if (r.spark?.verdict) {
    chips.push({ k: 'spark', tier: TIER[r.policy?.verdict] || 'escalate', text: `Spark ${r.spark.verdict} ${Math.round((r.spark.confidence || 0) * 100)}%`, rule: r.policy?.rule || null });
  }
  if (r.wonder) chips.push({ k: 'wonder', tier: TIER[r.wonder.verdict] || 'escalate', text: `Wonder ${r.wonder.wonderVerdict || r.wonder.verdict}${r.wonder.rule === 'wonder-guard' ? ' (guarded)' : ''}` });
  if (r.trap) chips.push({ k: 'trap', tier: 'trap', text: r.trap.source === 'model' ? 'Trap · Spark 1.3' : `Trap · ${r.trap.source}` });
  const action = r.wonder?.action || r.action || null;
  return {
    turn: t.turn,
    caller: t.caller,
    chips,
    action,
    tactic: r.spark?.tactic && r.spark.tactic !== 'none' ? r.spark.tactic : null,
    reply: (r.lines || []).map((l) => ({ kind: l.kind, text: l.text })),
  };
}

export function matchView(c, why) {
  return {
    id: c.id,
    cls: c.cls,
    persona: c.persona,
    gender: c.gender,
    lang: c.lang,
    tactic: c.tactic,
    mood: c.mood,
    scamPolicy: c.scamPolicy,
    why,
    opening: c.transcript?.[0]?.text || '',
    turns: c.turns.map(turnView),
    endedBy: c.endedBy,
    outcome: c.score.outcome,
    correct: c.score.correct,
    firstCorrectTurn: c.score.firstCorrectTurn,
    intel: (c.intel || []).map((i) => ({ type: i.type, value: i.value })),
    usd: c.usd,
  };
}

// Default featured set: one per story, best example of each (deterministic).
export function autoPick(calls) {
  const done = calls.filter((c) => c.status === 'done');
  const scam = done.filter((c) => c.cls === 'scam');
  const legit = done.filter((c) => c.cls === 'legit');
  const picks = [];
  const add = (c, why) => { if (c && !picks.some((p) => p.c.id === c.id)) picks.push({ c, why }); };
  const by = (arr, f) => [...arr].sort((a, b) => f(b) - f(a) || a.id.localeCompare(b.id))[0];
  const caughtLate = scam.filter((c) => c.score.outcome === 'blocked' && c.score.firstCorrectTurn >= 3);
  add(by(caughtLate, (c) => c.score.firstCorrectTurn * 10 + c.turns.length), 'adaptive scammer, caught late');
  add(by(scam.filter((c) => /slowburn/.test(c.persona) && c.score.outcome === 'blocked'), (c) => c.score.firstCorrectTurn), 'slow burn: the ask comes late');
  add(by(scam.filter((c) => c.score.trapped), (c) => c.score.intelCount * 100 + c.turns.length), 'trap: stalls and collects intel');
  add(by(scam.filter((c) => /injection/.test(c.persona) && c.score.outcome === 'blocked'), (c) => c.turns.length), 'prompt injection aimed at the judge');
  add(by(scam.filter((c) => /convincing/.test(c.persona) && c.score.outcome === 'blocked'), (c) => c.score.firstCorrectTurn), 'answers every follow-up convincingly');
  add(by(scam.filter((c) => c.score.outcome !== 'blocked'), (c) => (c.score.outcome === 'allowed' ? 100 : 0) + c.turns.length), 'scam got through (honest miss)');
  add(by(legit.filter((c) => c.score.outcome === 'allowed'), (c) => c.turns.length), 'legit caller: message taken');
  add(by(legit.filter((c) => c.score.outcome === 'blocked'), (c) => c.turns.length), 'legit caller wrongly hung up (honest miss)');
  return picks;
}

export function buildData(dir, { pick = null, after = null, rerun = [], edge = [], regional = [] } = {}) {
  const calls = readCalls(dir);
  const done = calls.filter((c) => c.status === 'done');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const results = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  const picks = pick
    ? pick.map((id) => {
      const c = done.find((x) => x.id === id);
      if (!c) throw new Error(`unknown or unfinished match ${id}`);
      return { c, why: '' };
    })
    : autoPick(calls);
  const totals = summarize(done);
  const data = {
    builtAt: new Date().toISOString(),
    source: `eval-results/${path.basename(dir)}`,
    run: {
      personaModel: manifest.personaModel,
      personaEffort: manifest.personaEffort,
      verdictModel: manifest.verdictModel,
      maxTurns: manifest.maxTurns,
      git: manifest.git?.commit ? manifest.git.commit.slice(0, 7) : null,
      spentUsd: results.manifest?.spentUsd ?? null,
    },
    totals: { all: totals.all, train: totals.train, holdout: totals.holdout },
    personas: { scam: new Set(done.filter((c) => c.cls === 'scam').map((c) => c.persona)).size, legit: new Set(done.filter((c) => c.cls === 'legit').map((c) => c.persona)).size },
    matches: picks.map(({ c, why }) => {
      const m = matchView(c, why);
      for (const d of rerun) {
        const r = readCalls(d).find((x) => x.id === c.id && x.status === 'done');
        if (r) {
          const mode = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')).mode || '';
          m.afterFix = { outcome: r.score.outcome, correct: r.score.correct, replay: mode.startsWith('replay'), source: `eval-results/${path.basename(d)}` };
          break;
        }
      }
      return m;
    }),
  };
  if (edge.length) {
    // later dirs override earlier ones for the same call id (a re-run on the fixed code)
    const byId = new Map();
    for (const d of edge) for (const c of readCalls(d)) if (c.status === 'done' && c.cls === 'edge') byId.set(c.id, { ...c, src: path.basename(d) });
    const ecalls = [...byId.values()];
    const es = summarize(ecalls);
    const byExpect = {};
    for (const c of ecalls) {
      const e = (byExpect[c.score.expect] ||= { n: 0, met: 0 });
      e.n += 1;
      if (c.score.expectMet) e.met += 1;
    }
    data.edge = {
      sources: edge.map((d) => `eval-results/${path.basename(d)}`),
      personas: new Set(ecalls.map((c) => c.persona)).size,
      bySource: Object.fromEntries(edge.map((d) => [path.basename(d), ecalls.filter((c) => c.src === path.basename(d)).length])),
      urgent: ecalls.filter((c) => c.score.expect === 'URGENT_MESSAGE').map((c) => ({ id: c.id, outcome: c.score.outcome, reportType: c.score.reportType ?? null, met: c.score.expectMet })),
      calls: ecalls.length,
      met: ecalls.filter((c) => c.score.expectMet).length,
      families: es.families,
      byExpect,
      failures: es.edgeFailures,
    };
    // featured: one of each story, preferring catalog personas
    const want = [
      [(c) => c.score.expect === 'HARASSMENT_RECORD' || c.score.expect === 'harass', 'harassing caller: polite close, recorded as harassment, not a scam'],
      [(c) => c.score.expect === 'URGENT_MESSAGE', 'real emergency: message taken, never blocked'],
      [(c) => /drunk|troll|prank|inject/.test(c.persona) && c.score.expect === 'POLITE_CLOSE_NUISANCE', 'drunk / prankster: polite close, never SCAM'],
      [(c) => c.score.family === 'debt-fake', 'fake debt collector (personal account): blocked'],
      [(c) => c.score.family && c.score.family.startsWith('green') && c.lang !== 'th', 'everyday caller, other language'],
    ];
    for (const [f, why] of want) {
      // prefer a call whose live close shows the feature (e.g. the urgent line)
      const shows = (x) => x.turns.some((t) => (t.rx?.lines || []).some((l) => /เรื่องด่วน/.test(l.text)));
      const pool = ecalls.filter(f).sort((a, b) => Number(shows(b)) - Number(shows(a)) || Number(/^cat-emerg-/.test(b.id)) - Number(/^cat-emerg-/.test(a.id)) || a.id.localeCompare(b.id));
      const c = pool.find((x) => x.score.expectMet && x.id.startsWith('cat-')) || pool.find((x) => x.score.expectMet) || pool[0];
      if (c && !data.matches.some((m) => m.id === c.id)) data.matches.push({ ...matchView(c, why), expect: c.score.expect, family: c.score.family || null });
    }
  }
  if (regional.length) data.regional = regionalView(regional, data);
  if (after) {
    const a = JSON.parse(fs.readFileSync(path.join(after, 'results.json'), 'utf8'));
    data.after = { source: `eval-results/${path.basename(after)}`, mode: a.manifest?.mode, totals: a.summary };
  }
  return data;
}

// B27: per-language table from the regional run (after) and the Thai-only
// before run (English only), plus featured regional matches.
const LANG_NAME = { en: 'English', zh: 'Mandarin 中文', vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', tl: 'Tagalog', ja: 'Japanese', ko: 'Korean', hi: 'Hindi' };
export function regionalView([afterDir, beforeDir], data) {
  const view = (d) => {
    const calls = readCalls(d).filter((c) => c.status === 'done' && c.cls === 'edge');
    const s = summarize(calls);
    const nu = {};
    for (const c of calls) {
      const e = (nu[c.lang] ||= { n: 0, notUnderstood: 0 });
      e.n += 1;
      if (notUnderstoodAfterReply(c)) e.notUnderstood += 1;
    }
    const langs = Object.fromEntries(Object.entries(s.languages || {}).map(([k, v]) => [k, { ...v, name: LANG_NAME[k] || k, notUnderstood: nu[k]?.notUnderstood ?? 0 }]));
    return { source: `eval-results/${path.basename(d)}`, calls, langs };
  };
  const a = view(afterDir);
  const b = beforeDir ? view(beforeDir) : null;
  const order = ['en', 'zh', 'vi', 'id', 'ms', 'tl', 'ja', 'ko', 'hi'];
  const want = [
    [(c) => c.lang === 'en' && c.score.expect === 'URGENT_MESSAGE' && c.score.expectMet, 'English emergency: disclosure and close in English, flagged urgent'],
    [(c) => c.lang === 'zh' && /scam-police-safeacct|scam-video-custody/.test(c.persona) && c.score.outcome === 'blocked', 'Mandarin fake police: blocked, replies in Mandarin'],
    [(c) => c.lang === 'zh' && c.score.family === 'green-everyday' && c.score.expectMet && c.turns.length >= 3, 'Mandarin everyday caller: message taken'],
    [(c) => c.lang === 'en' && /digital-arrest/.test(c.persona) && c.score.outcome === 'blocked', 'English "digital arrest": blocked'],
    [(c) => c.lang === 'ko' && c.score.expectMet, 'Korean caller: English with a one-line note (probe)'],
    [(c) => c.lang === 'zh' && /police-real/.test(c.persona) && !c.score.expectMet, 'real police officer wrongly blocked (honest miss)'],
  ];
  const featured = [];
  for (const [f, why] of want) {
    const c = a.calls.filter(f).sort((x, y) => x.id.localeCompare(y.id))[0];
    if (c && !data.matches.some((m) => m.id === c.id)) {
      featured.push(c.id);
      data.matches.push({ ...matchView(c, why), expect: c.score.expect, family: c.score.family || null });
    }
  }
  return {
    sources: [a.source, ...(b ? [b.source] : [])],
    order: order.filter((k) => a.langs[k]),
    after: a.langs,
    before: b ? b.langs : null,
    featured,
    failures: summarize(a.calls).edgeFailures.map((f) => ({ ...f, lang: a.calls.find((c) => c.id === f.id)?.lang })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const dir = path.resolve(argv[0] || '');
  const opt = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--pick') opt.pick = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--after') opt.after = path.resolve(argv[++i]);
    else if (argv[i] === '--edge') opt.edge = argv[++i].split(',').map((d) => path.resolve(d));
    else if (argv[i] === '--regional') opt.regional = argv[++i].split(',').map((d) => path.resolve(d));
    else if (argv[i] === '--rerun') opt.rerun = argv[++i].split(',').map((d) => path.resolve(d));
    else throw new Error(`unknown option ${argv[i]}`);
  }
  const data = buildData(dir, opt);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${data.matches.length} matches, ${data.totals.all.calls} games`);
  for (const m of data.matches) console.log(` - ${m.id} · ${m.outcome} · ${m.why}`);
}
