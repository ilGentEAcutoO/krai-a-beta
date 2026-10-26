// Baseline judge wiring (new, thin): hard rules -> ONE Jev request ->
// code policy -> Gemini escalation when Jev is unsure -> rules fallback.
// Persona lines are canned (free): the baseline measures judging only.
// The Question text, thresholds and regexes live in the frozen files next
// to this one (jev/policy/rules/gemini.js) and are never edited here.
import {
  ALL_SIGNALS, T, decide, guardGemini, geminiConfidence, nextAction, round, templateReasons, zeroSignals,
} from './policy.js';
import { hardRule, rulesFallback, rulesSignals } from './rules.js';
import { askJev, buildState, parseTurn, probeJev, TURN_QUESTIONS } from './jev.js';
import {
  generateJson, parseJson, probeGemini, thinkingFor, validVerdict, VERDICT_SCHEMA, ESCALATION_SYSTEM,
} from './gemini.js';

export { nextAction, ALL_SIGNALS };

export function normalizeTurns(turns = [], callerText) {
  const out = [];
  for (const t of turns || []) {
    const text = String(t?.text || '').trim();
    if (text) out.push({ role: t.role === 'caller' ? 'caller' : 'ai', text });
  }
  const extra = String(callerText || '').trim();
  const lastCaller = [...out].reverse().find((t) => t.role === 'caller');
  if (extra && lastCaller?.text !== extra) out.push({ role: 'caller', text: extra });
  return out;
}

const OPENING = {
  th: 'สวัสดีค่ะ ตอนนี้เจ้าของเบอร์ไม่สะดวกรับสาย ดิฉันรับสายแทนนะคะ ไม่ทราบว่าใครโทรมา แล้วมีธุระอะไรคะ',
  en: "Hello, the owner of this phone can't pick up right now, so I'm answering for them. May I ask who is calling, and what it's about?",
};
export const openingLine = (lang = 'th') => OPENING[lang === 'en' ? 'en' : 'th'];

const CANNED = {
  th: {
    continue: [
      'ขอทราบชื่อ ตำแหน่ง และหน่วยงานของท่านได้ไหมคะ',
      'รบกวนเล่าธุระที่โทรมาสั้นๆ ได้ไหมคะ เดี๋ยวจะแจ้งเจ้าของเบอร์ให้ค่ะ',
      'ขอเวลาตรวจสอบข้อมูลก่อนนะคะ รบกวนบอกชื่อหน่วยงานกับธุระไว้ค่ะ',
    ],
    'wrap-up': 'รับทราบค่ะ เดี๋ยวจะแจ้งเรื่องให้เจ้าของเบอร์ทราบนะคะ',
    'close-scam': 'ขอบคุณที่โทรมานะคะ เดี๋ยวจะแจ้งเจ้าของเบอร์ให้ตรวจสอบเองค่ะ สวัสดีค่ะ',
    'close-message': 'รับเรื่องไว้แล้วค่ะ จะแจ้งเจ้าของเบอร์ให้ติดต่อกลับนะคะ ขอบคุณค่ะ สวัสดีค่ะ',
    'close-unsure': 'รับเรื่องไว้แล้วค่ะ เดี๋ยวแจ้งเจ้าของเบอร์ให้ตัดสินนะคะ ขอบคุณค่ะ สวัสดีค่ะ',
  },
  en: {
    continue: [
      'Sure. May I have your name, your role and where you are calling from?',
      "Okay. Could you tell me briefly what the call is about? I'll let the owner know.",
      'I see. Could you tell me your organisation and what it is about, please?',
    ],
    'wrap-up': "Thanks, I'll pass your message on to the owner.",
    'close-scam': "Thanks for calling. I'll let the owner know, and they'll check it themselves. Goodbye.",
    'close-message': "Thanks, I've got your message. The owner will get back to you. Goodbye.",
    'close-unsure': 'Thanks, I have noted your message. The owner will decide what to do next. Goodbye.',
  },
};

function cannedLine(mode, callerTurns, lang) {
  const set = CANNED[lang === 'en' ? 'en' : 'th'];
  if (mode !== 'continue') return set[mode];
  return set.continue[Math.min(Math.max(callerTurns - 1, 0), set.continue.length - 1)];
}

export function createJudge({ fetch, config } = {}) {
  const c = config || {};
  const clock = Date.now;
  const doFetch = fetch || ((...a) => globalThis.fetch(...a));
  const jevReady = () => String(c.typesafeApiKey || '').length > 10;
  const geminiReady = () => String(c.geminiApiKey || '').length > 10;
  const jevTimeout = () => c.jevTimeoutMs || 4000;
  const turnTimeout = () => c.geminiTurnTimeoutMs || 4000;
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

  async function callJev(state, questions, parse, timeoutMs = jevTimeout()) {
    const opts = { fetch: doFetch, apiKey: c.typesafeApiKey, model: c.jevModel || 'jev-latest' };
    const t = clock();
    let r;
    try {
      r = await askJev({ ...opts, timeoutMs }, state, questions);
    } catch (e) {
      const wait = 100 + Math.floor(Math.random() * 200);
      const remaining = timeoutMs - (clock() - t) - wait;
      if (!/jev-http-(429|529)/.test(e.message) || remaining < 250) throw e;
      await sleep(wait);
      r = await askJev({ ...opts, timeoutMs: remaining }, state, questions);
    }
    return { ...parse(r.answers), model: r.model };
  }

  async function callGemini(req, validate, timeoutMs = turnTimeout()) {
    const opts = { fetch: doFetch, apiKey: c.geminiApiKey, model: c.geminiModel, timeoutMs, thinkingLevel: thinkingFor(c.geminiModel) };
    const out = validate(parseJson(await generateJson(opts, req)));
    if (!out) throw new Error('gemini-bad-output');
    return out;
  }

  const transcriptData = (convo) => convo.map((t) => ({ speaker: t.role === 'caller' ? 'caller' : 'receptionist', text: t.text }));
  const signalData = (s) => Object.fromEntries(ALL_SIGNALS.map((k) => [k, round(s[k])]));

  async function geminiVerdict(convo, signals, timeoutMs) {
    if (!geminiReady() || timeoutMs < 200) return null;
    try {
      return await callGemini({
        system: ESCALATION_SYSTEM, schema: VERDICT_SCHEMA, maxTokens: 400,
        task: 'Decide the verdict for this call and write the reasons.',
        data: { transcript: transcriptData(convo), screening_signals: signals ? signalData(signals) : null },
      }, validVerdict, timeoutMs);
    } catch {
      return null;
    }
  }

  async function judgeTurn({ turns = [], callerText, lang = 'th' } = {}) {
    const t0 = clock();
    const budget = c.judgeBudgetMs || 5000;
    const left = () => t0 + budget - clock();
    const convo = normalizeTurns(turns, callerText);
    const callerLines = convo.filter((t) => t.role === 'caller').map((t) => t.text);
    const out = (r, { reasons, reasonEngine } = {}) => {
      const rs = reasons || templateReasons(r.verdict, r.signals);
      return {
        verdict: r.verdict,
        confidence: round(r.confidence),
        signals: signalData({ ...zeroSignals(), ...r.signals }),
        reasonTh: rs.reasonTh,
        reasonEn: rs.reasonEn,
        engine: r.engine,
        reasonEngine: reasonEngine || 'template',
        escalated: Boolean(r.escalated),
        ...(r.probabilities ? { probabilities: r.probabilities } : {}),
        ...(r.model ? { model: r.model } : {}),
        lang,
        latencyMs: clock() - t0,
      };
    };

    if (!callerLines.length) return out({ verdict: 'UNSURE', confidence: 0, signals: zeroSignals(), engine: 'rule' });

    const hard = hardRule(callerLines);

    if (jevReady()) {
      let jev = null;
      try {
        jev = await callJev(buildState(convo), TURN_QUESTIONS, parseTurn, Math.min(jevTimeout(), budget / 2));
      } catch {
        jev = null;
      }
      if (jev) {
        const base = { signals: jev.signals, probabilities: jev.probabilities, model: jev.model };
        if (hard && jev.signals[hard.confirm] >= T.confirm) return out({ ...base, verdict: 'SCAM', confidence: 0.95, engine: 'rule' });
        const d = decide(jev);
        if (!d.escalate) return out({ ...base, verdict: d.verdict, confidence: d.confidence, engine: 'jev' });
        const g = await geminiVerdict(convo, jev.signals, Math.min(turnTimeout(), left()));
        if (g) {
          const verdict = guardGemini(g.verdict, jev.signals);
          const reasons = verdict === g.verdict ? { reasonTh: g.reasonTh, reasonEn: g.reasonEn } : null;
          return out(
            { ...base, verdict, confidence: geminiConfidence(verdict, jev.probabilities), engine: 'gemini', escalated: true },
            reasons ? { reasons, reasonEngine: 'gemini' } : {},
          );
        }
        return out({ ...base, verdict: d.verdict, confidence: d.confidence, engine: 'jev' });
      }
    }

    if (hard) return out({ verdict: 'SCAM', confidence: 0.95, signals: hard.signals, engine: 'rule' });
    const { signals: ruleSigs } = rulesSignals(callerLines);
    const g = await geminiVerdict(convo, null, Math.min(turnTimeout(), left()));
    if (g) {
      const verdict = guardGemini(g.verdict, ruleSigs);
      const reasons = verdict === g.verdict ? { reasonTh: g.reasonTh, reasonEn: g.reasonEn } : null;
      return out(
        { verdict, confidence: geminiConfidence(verdict, null), signals: ruleSigs, engine: 'gemini', escalated: true },
        reasons ? { reasons, reasonEngine: 'gemini' } : {},
      );
    }

    const fb = rulesFallback(callerLines);
    return out({ ...fb, engine: 'rules-fallback' });
  }

  async function personaReply({ turns = [], verdict, lang = 'th', action } = {}) {
    const convo = normalizeTurns(turns);
    const callerTurns = convo.filter((t) => t.role === 'caller').length;
    const v = typeof verdict === 'string' ? { verdict, confidence: 1 } : verdict || { verdict: 'UNSURE', confidence: 0 };
    const act = action || nextAction(v, callerTurns, { maxTurns: c.maxTurnsPerCall || 12 });
    if (!convo.length && act === 'continue') return { text: openingLine(lang), engine: 'canned', action: act, closing: false, latencyMs: 0 };
    const closeMode = act === 'hangup' ? 'close-scam' : v.verdict === 'UNSURE' ? 'close-unsure' : 'close-message';
    const mode = act === 'continue' ? 'continue' : closeMode;
    return { text: cannedLine(mode, callerTurns, lang), engine: 'canned', action: act, closing: act !== 'continue', latencyMs: 0 };
  }

  async function probeEngines({ timeoutMs = 4000 } = {}) {
    const out = { jev: false, gemini: false };
    if (jevReady()) {
      try {
        await probeJev({ fetch: doFetch, apiKey: c.typesafeApiKey, timeoutMs });
        out.jev = true;
      } catch { /* stays false */ }
    }
    if (geminiReady() && c.geminiModel) {
      try {
        await probeGemini({ fetch: doFetch, apiKey: c.geminiApiKey, model: c.geminiModel, timeoutMs });
        out.gemini = true;
      } catch { /* stays false */ }
    }
    return out;
  }

  return { judgeTurn, personaReply, nextAction, probeEngines };
}
