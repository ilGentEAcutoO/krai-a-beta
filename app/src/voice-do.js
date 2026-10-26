// VoiceCall Durable Object: the server-side half of browser -> DO -> Meta.
// The Meta key lives here (wrangler secret) — the browser only ever talks to
// us. One DO instance per call (worker routes by ?call= id), so storage keys
// need no call prefix. Hibernation API throughout: acceptWebSocket + the
// webSocket* handlers, so idle connections cost no duration (spike 41 §2).
// `env.VOICE_META_WS` overrides the Meta URL — a test seam, unset in prod.
import { VOICE_WS, createRelay } from './voice.js';

const CALL_RE = /^[A-Za-z0-9-]{1,64}$/;

export class VoiceCall {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.relay = null;
    this.callId = null;
  }

  ensureRelay() {
    if (this.relay) return this.relay;
    const apiKey = this.env.META_MODEL_API_KEY || '';
    if (!apiKey) return null;
    this.relay = createRelay({
      apiKey,
      metaUrl: this.env.VOICE_META_WS || VOICE_WS,
      openMeta: (url) => new WebSocket(url),
      sendToClient: (text) => {
        for (const ws of this.state.getWebSockets()) {
          try { ws.send(text); } catch { /* dead socket; close handler prunes */ }
        }
      },
      onFinal: (turn) => {
        const p = this.state.storage.put(`turn:${turn.turnId ?? 'untracked'}`, {
          ...turn,
          at: new Date().toISOString(),
        });
        if (this.state.waitUntil) this.state.waitUntil(p.catch(() => {}));
      },
    });
    return this.relay;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const callId = url.searchParams.get('call') || 'demo';
    if (!CALL_RE.test(callId)) return new Response('bad-call', { status: 400 });
    this.callId = callId;

    // Non-upgrade GET: debug view of the persisted turns (no audio, no key).
    if (request.headers.get('Upgrade') !== 'websocket') {
      const map = await this.state.storage.list({ prefix: 'turn:' });
      const turns = [...map.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
      return Response.json({ ok: true, call: callId, turns, relay: this.relay?.session() || null });
    }
    if (!this.env.META_MODEL_API_KEY) return new Response('missing-key', { status: 500 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    // Fresh call (no relay yet): wipe turns left by a previous call that
    // reused this DO name, then open the Meta session while the user
    // grants mic permission.
    if (!this.relay) {
      const stale = await this.state.storage.list({ prefix: 'turn:' });
      if (stale.size) await this.state.storage.delete([...stale.keys()]);
      const relay = this.ensureRelay();
      if (relay) relay.clientConnected();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation wakeups: `this.relay` may be gone after eviction — the relay
  // re-opens Meta transparently (relay.stats.resumed counts it) and the
  // client replays state via { type:'get-turns' }.
  async webSocketMessage(ws, message) {
    const relay = this.ensureRelay();
    if (!relay) {
      try { ws.send(JSON.stringify({ type: 'error', message: 'missing-key' })); } catch { /* gone */ }
      return;
    }
    relay.onClientMessage(message);
  }

  async webSocketClose() {
    if (this.state.getWebSockets().length === 0 && this.relay) {
      this.relay.onClientGone();
      this.relay = null;
    }
  }

  async webSocketError() {
    // Treat like a close; the close handler runs the same cleanup.
  }
}
