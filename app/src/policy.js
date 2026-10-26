// Meta-path policy (new): the ONLY place that turns Spark outputs into a
// verdict, a confidence, a Wonder-escalation decision and the next action.
// Tiers: T1 instant demand rules (no AI wait) -> T2 Spark verdict ->
// T3 Wonder (B8) for the grey zone. Thresholds start at the v2 values and
// may be retuned on TRAIN data only after live runs — never on sealed.
// Models report; this file owns every consequence.
export const SIGNAL_KEYS = [
  'authority', 'urgency', 'secrecy', 'moneyTransfer', 'otpRequest',
  'appInstall', 'identityProbe', 'injection', 'callbackGiven',
];

export const T = {
  demand: 0.85, // otp/app-install signal: a direct scam demand by itself
  transfer: 0.85, // money-transfer signal, when backed by authority or pressure
  backing: 0.7,
  risk: 0.5, // any risk signal at/above this blocks LEGIT
  injection: 0.5,
  sparkScam: 0.8, // Spark SCAM confidence to accept outright
  sparkLegit: 0.8, // Spark LEGIT confidence to accept (and no risk signal)
  escalateConf: 0.5, // Spark confidence below this goes to Wonder
  hangup: 0.85, // SCAM confidence that ends the call
  legitClose: 0.8,
  callback: 0.6,
  legitMaxTurns: 3,
  unsureMaxTurns: 4,
};

export const zeroSignals = () => Object.fromEntries(SIGNAL_KEYS.map((k) => [k, 0]));
const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));
export const round = (x) => Math.round(clamp01(x) * 1000) / 1000;

export function riskOf(s) {
  return Math.max(s.moneyTransfer, s.otpRequest, s.appInstall, s.secrecy);
}

// ---- T1: instant demand rules (caller text only) ----
// A warning AGAINST the act ("อย่าบอก OTP ใคร") must not fire: real banks
// talk that way. Anything suppressed here still goes to Spark, never to LEGIT.
const NOT_OTP = /(ไม่|อย่า|ห้าม)\s*(ต้อง|ควร)?\s*(บอก|แจ้ง|ให้|เปิดเผย|ขอ)\s*(รหัส|otp|โอทีพี)|ไม่มีนโยบาย.{0,12}(ขอ|ถาม)|(never|don't|do not)\s+(share|give|tell)\b.{0,20}\b(otp|code|pin)/i;
const NOT_APP = /(ไม่|อย่า|ห้าม)\s*(ต้อง|ควร)?\s*(โหลด|ติดตั้ง|ลง|กด)|(never|don't|do not)\s+(install|click|open)/i;
const NOT_TRANSFER = /(ไม่|อย่า|ห้าม)\s*(ต้อง|ควร)?\s*โอน|(never|don't|do not)\s+transfer/i;
const OTP = '(otp|โอทีพี|รหัสยืนยัน|รหัส\\s*(6|หก)\\s*หลัก|รหัสผ่าน)';
const OTP_DEMAND = new RegExp(
  `(รบกวน|ช่วย|ขอให้|กรุณา|ต้อง)\\s*(บอก|แจ้ง|อ่าน).{0,30}${OTP}`
  + `|(บอก|แจ้ง|อ่าน).{0,30}${OTP}.{0,40}(มา|ให้\\s*(ผม|ดิฉัน|เรา|หนู|ฉัน|พี่|เจ้าหน้าที่)|หน่อย)`
  + '|\\b(tell|give|read)\\s+(me|us)\\b.{0,30}\\b(otp|verification code|one-time code|code|pin)\\b'
  + "|\\b(what'?s|what is|read out)\\s+the\\b.{0,20}\\b(otp|code|pin)\\b",
  'i',
);
const T1_RULES = [
  { id: 'otp', re: OTP_DEMAND, not: NOT_OTP },
  { id: 'app', re: /(โหลด|ติดตั้ง|ลง).{0,20}(แอป|app).{0,30}(ตามลิงก์|ลิงก์|ที่ส่งให้)|install\b.{0,30}\bapp\b.{0,30}\blink\b/i, not: NOT_APP },
  { id: 'transfer-now', re: /(โอนเงิน|โอนมา).{0,30}(เดี๋ยวนี้|ด่วน|ทันที)|transfer\b.{0,30}\b(right now|immediately)\b/i, not: NOT_TRANSFER },
  { id: 'secrecy-transfer', re: /(ห้ามวางสาย|อย่าวางสาย).{0,60}(โอน|กด|ทำตาม)|(don't|do not) hang up\b.{0,60}\b(transfer|press|follow)/i, not: null },
];

// Returns a rule id when the caller text is an explicit demand, else null.
// A hit is a CANDIDATE: Spark's matching signal must confirm it (same call).
export function t1Demand(callerLines) {
  for (const line of callerLines) {
    for (const rule of T1_RULES) {
      if (rule.re.test(line) && !(rule.not && rule.not.test(line))) return rule.id;
    }
  }
  return null;
}

// ---- T2: Spark verdict -> decision ----
export function decideSpark({ verdict, confidence, signals }) {
  const s = { ...zeroSignals(), ...signals };
  const conf = clamp01(confidence);
  const demand = Math.max(s.otpRequest, s.appInstall);
  const backed = Math.max(s.authority, s.urgency, s.secrecy) >= T.backing;
  const risk = riskOf(s);

  if (demand >= T.demand) return { verdict: 'SCAM', confidence: round(Math.max(conf, demand)), escalate: false, rule: 'demand' };
  if (s.moneyTransfer >= T.transfer && backed) {
    return { verdict: 'SCAM', confidence: round(Math.max(conf, s.moneyTransfer)), escalate: false, rule: 'transfer' };
  }
  if (verdict === 'SCAM' && conf >= T.sparkScam) return { verdict: 'SCAM', confidence: round(conf), escalate: false, rule: 'spark' };
  if (verdict === 'LEGIT' && conf >= T.sparkLegit && risk < T.risk && s.injection < T.injection && s.identityProbe < T.risk) {
    return { verdict: 'LEGIT', confidence: round(conf), escalate: false, rule: 'spark' };
  }
  // Grey zone -> Wonder (T3): Spark is flat, or leans somewhere the policy
  // could not accept (SCAM below bar, or LEGIT contradicted by a risk signal).
  const escalate = conf < T.escalateConf || verdict !== 'UNSURE';
  return { verdict: 'UNSURE', confidence: round(verdict === 'UNSURE' ? conf : 1 - conf), escalate, rule: escalate ? 'escalate' : 'spark' };
}

// Wonder may raise suspicion freely, but can never clear a call that Spark
// saw asking for something sensitive, probing for identity, or talking to the AI.
export function guardEscalation(verdict, signals) {
  const s = { ...zeroSignals(), ...signals };
  if (verdict === 'LEGIT' && (riskOf(s) >= T.risk || s.injection >= T.injection || s.identityProbe >= T.risk)) return 'UNSURE';
  return verdict;
}

// Wonder is not calibrated: moderate unless Spark agreed with the verdict.
export function escalationConfidence(verdict, sparkVerdict, sparkConfidence) {
  if (verdict === sparkVerdict) return round(0.5 + 0.5 * clamp01(sparkConfidence));
  return 0.6;
}

// ---- call action ----
export function nextAction(v, turnCount, { maxTurns = 12 } = {}) {
  const verdict = typeof v === 'string' ? v : v?.verdict || 'UNSURE';
  const confidence = typeof v === 'string' ? 1 : Number(v?.confidence) || 0;
  const callback = typeof v === 'object' && v?.signals ? Number(v.signals.callbackGiven) || 0 : 0;
  const n = Number(turnCount) || 0;
  if (n >= maxTurns) return verdict === 'SCAM' ? 'hangup' : 'take-message';
  if (verdict === 'SCAM' && confidence >= T.hangup) return 'hangup';
  if (verdict === 'LEGIT' && confidence >= T.legitClose && (callback >= T.callback || n >= T.legitMaxTurns)) return 'take-message';
  if (verdict === 'UNSURE' && callback >= T.callback && n >= 2) return 'take-message';
  if (n >= T.unsureMaxTurns) return verdict === 'SCAM' ? 'hangup' : 'take-message';
  return 'continue';
}

// ---- reply guard: never speak a risky line (lexical, no AI wait) ----
// Blocks: agreeing to move money / give codes / install / open links,
// leaking owner facts, claiming line problems, naming the receptionist.
// Conservative by design: a blocked line falls back to a canned line, so a
// false block costs one turn, never a scam payout. Limits are documented:
// subtle paraphrases need the Wonder guard upgrade (B8) if live data demands it.
const COMPLY = [
  /(จะ|ขอ)?\s*(โอนเงิน|โอนให้|ชำระเงิน|จ่ายเงิน)(ให้|ไป)?/i,
  /(บอก|แจ้ง|ให้)\s*(รหัส|otp|โอทีพี|พิน|pin|password|รหัสผ่าน)/i,
  /(โหลด|ติดตั้ง|ลง)(แอป|app)/i,
  /(กด|คลิก|เปิด)(ลิงก์|link)/i,
  /(will|shall)\s+(transfer|pay|send the money|install|click)/i,
  /(here is|here's)\s+(the\s+)?(otp|code|pin|password)/i,
  /(โอน|จ่าย|ชำระ)\s*[0-9๐-๙]/,
];
const LINE_PROBLEM = /(สัญญาณ|ไม่ได้ยิน|ได้ยินไม่ชัด|เสียงขาด|เสียงไม่ชัด|สายหลุด|สายตัด|ระบบขัดข้อง|bad signal|can'?t hear|cannot hear|breaking up|call (dropped|dropping)|system error|on hold|โอนสาย|พักสาย)/i;
const SELF_NAME = /(ดิฉัน|ผม|หนู|ฉัน)\s*ชื่อ\s*\S|my name is|this is [A-Zก-๙]/;
// Code/account/phone-shaped leaks: 6+ digit runs (spaces/dashes allowed).
// Catches OTPs (6), phones (9-10), accounts (10+); years (4) still pass.
const DIGIT_RUN = /(\d[\s-]?){5,}\d/;

export function guardReply(text, { ownerFacts = [] } = {}) {
  // Warnings ("ไม่ต้องโอนเงิน", "never share the code") are safe to say:
  // strip negation spans before testing compliance phrases.
  const t = String(text || '').replace(
    /(ไม่|อย่า|ห้าม)\s*(ต้อง|ควร|เคย)?\s*(โอน|บอก|แจ้ง|ให้|โหลด|ติดตั้ง|ลง|กด|เปิดเผย|ขอ).{0,12}|(never|don't|do not)\s+\w+.{0,12}/gi,
    '',
  );
  const reasons = [];
  if (COMPLY.some((re) => re.test(t))) reasons.push('comply');
  if (LINE_PROBLEM.test(t)) reasons.push('line-problem');
  if (SELF_NAME.test(t)) reasons.push('self-name');
  if (DIGIT_RUN.test(t)) reasons.push('digit-run');
  for (const fact of ownerFacts) {
    if (fact && String(text || '').includes(String(fact))) {
      reasons.push('owner-fact');
      break;
    }
  }
  return { ok: reasons.length === 0, reasons };
}

// ---- code-written reasons from signals ----
const PHRASE = {
  otpRequest: ['ขอรหัส OTP/รหัสยืนยัน', 'asks for an OTP/verification code'],
  appInstall: ['ให้ติดตั้งแอปหรือกดลิงก์', 'asks to install an app or open a link'],
  moneyTransfer: ['ขอให้โอนเงินหรือขอเลขบัญชี', 'asks for a money transfer or account number'],
  secrecy: ['สั่งห้ามวางสาย/ห้ามบอกใคร', "demands secrecy / don't hang up"],
  urgency: ['ข่มขู่หรือเร่งให้รีบทำ', 'threatens or rushes the owner'],
  authority: ['แจ้งว่าโทรจากหน่วยงานหรือบริษัท', 'says it is calling from an organisation or company'],
  identityProbe: ['ถามข้อมูลส่วนตัว', 'probes for personal details'],
  injection: ['พยายามสั่งระบบ AI', 'tries to give orders to the AI'],
};
const ORDER = ['otpRequest', 'appInstall', 'moneyTransfer', 'secrecy', 'urgency', 'authority', 'injection', 'identityProbe'];

export function templateReasons(verdict, signals, { min = 0.6, max = 3 } = {}) {
  const s = { ...zeroSignals(), ...signals };
  const hits = ORDER.filter((k) => (s[k] || 0) >= min).slice(0, max);
  const th = hits.map((k) => PHRASE[k][0]).join(' + ');
  const en = hits.map((k) => PHRASE[k][1]).join(' + ');
  if (verdict === 'SCAM') {
    return {
      reasonTh: hits.length ? `สัญญาณมิจฉาชีพ: ${th}` : 'บทสนทนาเข้าเค้าสคริปต์มิจฉาชีพ',
      reasonEn: hits.length ? `Scam signals: ${en}.` : 'The conversation matches a known scam script.',
    };
  }
  if (verdict === 'LEGIT') {
    return {
      reasonTh: 'ธุระชัดเจน ไม่ขอเงิน รหัส หรือให้ลงแอป',
      reasonEn: 'Clear everyday purpose; no request for money, codes or app installs.',
    };
  }
  return {
    reasonTh: hits.length ? `ยังสรุปไม่ได้: ${th}` : 'ข้อมูลยังไม่พอ ขอฟังต่อก่อน',
    reasonEn: hits.length ? `Not conclusive yet: ${en}.` : 'Not enough information yet; still listening.',
  };
}
