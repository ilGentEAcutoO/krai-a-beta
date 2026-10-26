import { Hono } from 'hono';

const app = new Hono();

// Liveness probe for deploy checks and judges. No secrets, no PII.
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    app: 'krai-a-beta',
    track: 'indie-solo',
    event: 'meta-global-ai-developer-hackathon-2026',
    now: new Date().toISOString(),
  })
);

app.notFound((c) => c.json({ ok: false, error: 'not-found' }, 404));

export default app;
