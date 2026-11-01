import test from 'node:test';
import assert from 'node:assert/strict';
import * as entry from '../src/index.js';

// workerd refuses to start when the entry module exports anything other than
// the default handler and classes (Durable Objects / entrypoints).
test('worker entry exports only the default handler and DO classes', () => {
  for (const [name, value] of Object.entries(entry)) {
    if (name === 'default') continue;
    assert.equal(typeof value, 'function', `${name} must be a class`);
    assert.match(Function.prototype.toString.call(value), /^class\b/, `${name} must be a class`);
  }
});
