// One JSON POST with a hard timeout and at most one retry.
//
// Retry rules (no retry storms):
//   - network error, HTTP 429 or 5xx -> one retry after a short pause;
//   - a timeout is retried only when the request is idempotent (LINE's
//     X-Line-Retry-Key), because a timed-out send may still have been delivered;
//   - 4xx (bad token, bad chat id, closed WhatsApp window) is never retried.
// Errors are short codes only. The URL is never put in an error: the Telegram
// token lives in the URL path.

export const NOTIFY_TIMEOUT_MS = 5000;
export const RETRY_PAUSE_MS = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(fetchFn, url, init, timeoutMs) {
  const ctl = new AbortController();
  let timer;
  let timedOut = false;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
      rej(Object.assign(new Error('timeout'), { code: 'timeout' }));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([fetchFn(url, { ...init, signal: ctl.signal }), timeout]);
    let body = null;
    try {
      body = await res.json();
    } catch { /* non-JSON body */ }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, error: timedOut ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson(fetchFn, url, { headers = {}, body, timeoutMs = NOTIFY_TIMEOUT_MS, idempotent = false, pauseMs = RETRY_PAUSE_MS } = {}) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
  let r = await once(fetchFn, url, init, timeoutMs);
  const retryable = r.error === 'network' || (r.error === 'timeout' && idempotent) || r.status === 429 || r.status >= 500;
  let attempts = 1;
  if (retryable) {
    await sleep(pauseMs);
    r = await once(fetchFn, url, init, timeoutMs);
    attempts = 2;
  }
  return { ...r, attempts };
}

// A real value: non-empty and not a `your-…` placeholder from .dev.vars.example.
export const isSet = (v) => typeof v === 'string' && v.trim() !== '' && !/^your-/i.test(v.trim());
