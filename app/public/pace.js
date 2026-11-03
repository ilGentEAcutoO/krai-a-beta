/* Receptionist pace for LIVE trap lines (B20). Fixed lines are paced offline
 * by scripts/tts-pregen.mjs (ffmpeg: trim silence, cap pauses at 250 ms,
 * atempo to ~5.75 Thai syllables/s). A trap line Spark writes live comes
 * straight from Gemini, so the browser applies the same treatment here:
 * trimPauses() + a pitch-preserving time stretch (WSOLA) by the median tempo
 * of the fixed lines (manifest.json liveTempo). Pure functions, no DOM:
 * app/test/pace.test.mjs drives them in node.
 */

// Trim leading/trailing silence (keep edgeMs) and cut every inner pause
// longer than maxPauseMs down to maxPauseMs. Silence = 10 ms frames whose RMS
// is below threshDb (dBFS).
export function trimPauses(x, sr, { threshDb = -45, maxPauseMs = 250, edgeMs = 30 } = {}) {
  const f = Math.max(1, Math.round(sr * 0.01));
  const nF = Math.ceil(x.length / f);
  const thr = 10 ** (threshDb / 20);
  const loud = new Uint8Array(nF);
  for (let k = 0; k < nF; k++) {
    let e = 0;
    const end = Math.min(x.length, (k + 1) * f);
    for (let i = k * f; i < end; i++) e += x[i] * x[i];
    loud[k] = Math.sqrt(e / Math.max(1, end - k * f)) >= thr ? 1 : 0;
  }
  const first = loud.indexOf(1);
  if (first < 0) return x.slice(0, 0);
  const last = loud.lastIndexOf(1);
  const edge = Math.round(edgeMs / 10);
  const maxPause = Math.max(1, Math.round(maxPauseMs / 10));
  const keep = [];
  let k = Math.max(0, first - edge);
  const stop = Math.min(nF - 1, last + edge);
  while (k <= stop) {
    if (loud[k] || k < first || k > last) { keep.push(k); k++; continue; }
    let j = k;
    while (j <= last && !loud[j]) j++;
    const run = j - k;
    if (run <= maxPause) for (let q = k; q < j; q++) keep.push(q);
    else {
      const half = Math.floor(maxPause / 2);
      for (let q = k; q < k + half; q++) keep.push(q);
      for (let q = j - (maxPause - half); q < j; q++) keep.push(q);
    }
    k = j;
  }
  const out = new Float32Array(keep.length * f);
  let o = 0;
  for (const q of keep) {
    const seg = x.subarray(q * f, Math.min(x.length, (q + 1) * f));
    out.set(seg, o);
    o += seg.length;
  }
  return out.subarray(0, o);
}

// WSOLA time stretch: plays `tempo` times faster with the pitch kept.
// 30 ms Hann frames, 50% overlap, +-8 ms similarity search.
export function wsola(x, tempo, sr) {
  if (!(tempo > 1.005) || x.length < sr * 0.1) return x;
  const N = Math.round(sr * 0.03) & ~1;
  const Hs = N / 2;
  const tol = Math.round(sr * 0.008);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const outLen = Math.floor(x.length / tempo);
  const y = new Float32Array(outLen + N);
  const norm = new Float32Array(outLen + N);
  let prev = 0;
  for (let k = 0; ; k++) {
    const outPos = k * Hs;
    if (outPos >= outLen) break;
    const nominal = Math.round(outPos * tempo);
    let best = nominal;
    if (k > 0) {
      const target = prev + Hs; // where the previous frame would naturally continue
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const s = nominal + d;
        if (s < 0 || s + N > x.length) continue;
        let c = 0;
        for (let i = 0; i < Hs && target + i < x.length; i += 4) c += x[s + i] * x[target + i];
        if (c > bestScore) { bestScore = c; best = s; }
      }
    }
    if (best < 0 || best + N > x.length) break;
    for (let i = 0; i < N; i++) {
      y[outPos + i] += x[best + i] * win[i];
      norm[outPos + i] += win[i];
    }
    prev = best;
  }
  for (let i = 0; i < y.length; i++) if (norm[i] > 1e-3) y[i] /= norm[i];
  return y.subarray(0, outLen);
}

// AudioBuffer in -> paced AudioBuffer out (mono; first channel).
export function paceBuffer(ctx, buf, tempo = 1) {
  try {
    const sr = buf.sampleRate;
    const trimmed = trimPauses(buf.getChannelData(0), sr);
    if (!trimmed.length) return buf;
    const out = wsola(trimmed, tempo, sr);
    const b = ctx.createBuffer(1, out.length, sr);
    b.copyToChannel(out, 0);
    return b;
  } catch {
    return buf; // pacing is cosmetic: never lose the line over it
  }
}
