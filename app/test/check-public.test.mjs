import test from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../../scripts/check-public.js';

// Fixture values are assembled at runtime so this test file never contains a
// secret-looking literal itself (check-public scans it too).
const REALISH = ['q9Zk', 'Lm7X', 'p2Rt', 'Vw8N', 'c4Hs'].join('');

test('check-public: identifier-to-identifier assignments in code are not secrets', () => {
  assert.deepEqual(scanText('      sitekey: siteKey,\n', 'app/public/voice-client.js'), []);
  assert.deepEqual(scanText('  apiKey = env.META_MODEL_API_KEY;\n', 'src/x.mjs'), []);
  assert.deepEqual(scanText('const token = sessionToken\n', 'src/x.ts'), []);
});

test('check-public: literal secrets are still flagged, quoted or not', () => {
  assert.equal(scanText(`  sitekey: '${REALISH}',\n`, 'app/public/voice-client.js').length, 1, 'quoted literal in code');
  assert.equal(scanText(`  sitekey: "${REALISH}"\n`, 'app/src/a.js').length, 1);
  assert.equal(scanText(`  apiKey = ${REALISH}9\n`, 'app/src/a.js').length, 0, 'bare identifier-shaped token in code is a reference');
  assert.equal(scanText(`  apiKey = 9${REALISH}\n`, 'app/src/a.js').length, 1, 'non-identifier literal in code');
  assert.equal(scanText(`META_MODEL_API_KEY=${REALISH}\n`, 'app/.dev.vars.example').length, 1, 'env files get no exemption');
  assert.equal(scanText(`SESSION_SECRET=${REALISH}\n`, '.env').length, 1);
  assert.equal(scanText('SESSION_SECRET=your-random-64-hex-chars\n', 'app/.dev.vars.example').length, 0, 'placeholder ok');
});
