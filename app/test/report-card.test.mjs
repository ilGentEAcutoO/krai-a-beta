import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBySource, mergedSpans, reportText, snippetParts } from '../public/report-card.js';

const LINE = 'สวัสดีครับ ผมร้อยตำรวจเอกวิชัย จากสถานีตำรวจภูธรเมืองเชียงใหม่ บัญชีของคุณถูกใช้ฟอกเงิน ต้องโอนเงินไปบัญชีตรวจสอบ ธนาคารกรุงไทย เลขบัญชี 982-0-44512-7 ด่วน ห้ามบอกใคร';
const at = (needle) => [LINE.indexOf(needle), LINE.indexOf(needle) + needle.length];
const ITEMS = [
  { type: 'bank-account', labelTh: 'เลขบัญชี', value: '9820445127', quote: LINE, span: at('982-0-44512-7') },
  { type: 'bank', labelTh: 'ธนาคาร', value: 'กรุงไทย', quote: LINE, span: at('กรุงไทย') },
  { type: 'name', labelTh: 'ชื่อที่อ้าง', value: 'ร้อยตำรวจเอกวิชัย', quote: LINE, span: at('ร้อยตำรวจเอกวิชัย') },
  { type: 'line-id', labelTh: 'LINE ID', value: '@dsi-case99', quote: 'แอดไลน์ @dsi-case99 นะครับ', span: [8, 19] },
];

test('snippetParts: the match plus about 25 characters each side, not the whole sentence', () => {
  const p = snippetParts(LINE, at('982-0-44512-7'));
  assert.equal(p.match, '982-0-44512-7');
  assert.ok(p.before.length <= 36 && p.after.length <= 36, JSON.stringify(p));
  assert.ok(p.before.startsWith('…'));
  assert.ok((p.before + p.match + p.after).length < LINE.length);
  // no span -> a short plain prefix, never the full long line
  const n = snippetParts(LINE, null);
  assert.equal(n.match, '');
  assert.ok(n.after.length <= 71);
  // a bad span is ignored
  assert.equal(snippetParts('abc', [5, 9]).match, '');
});

test('snippetParts never starts or ends on a Thai vowel/tone mark', () => {
  const MARK = /[ัิ-ฺ็-๎]/;
  for (let s = 0; s < LINE.length - 5; s += 3) {
    const p = snippetParts(LINE, [s, s + 4]);
    const before = p.before.replace(/^…/, '');
    if (before) assert.ok(!MARK.test(before[0]), `starts on a mark at ${s}`);
    const after = p.after.replace(/…$/, '');
    if (after && p.after.endsWith('…')) assert.ok(!MARK.test(LINE[LINE.indexOf(p.match, s) + p.match.length + after.length] || ''), `cuts before a mark at ${s}`);
  }
});

test('groupBySource: fields sharing a sentence form one group; spans merge for bolding', () => {
  const g = groupBySource(ITEMS);
  assert.equal(g.length, 2);
  assert.equal(g[0].items.length, 3);
  const spans = mergedSpans(LINE, g[0].items);
  assert.equal(spans.length, 3);
  assert.ok(spans.every((sp, i) => i === 0 || sp[0] >= spans[i - 1][1]));
});

test('reportText: a shared caller sentence appears once, not once per field', () => {
  const text = reportText({ headlineTh: 'น่าจะเป็นมิจฉาชีพ', verdict: 'SCAM', confidence: 0.95, intel: ITEMS, nextSteps: [], generatedAt: 0 });
  assert.equal(text.split(LINE).length - 1, 1, text);
  assert.match(text, /เลขบัญชี: 9820445127/);
  assert.match(text, /"แอดไลน์ @dsi-case99 นะครับ"/);
});
