const { test } = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/recipes/rating');

test('a lone recipe sits in the middle of its thumb range', () => {
  assert.equal(r.scoreFor('like', 1, 1), 8.5);
  assert.equal(r.scoreFor('ok', 1, 1), 5.5);
  assert.equal(r.scoreFor('dislike', 1, 1), 2);
});

test('scores spread evenly and stay inside their range', () => {
  assert.deepEqual([1, 2].map(k => r.scoreFor('like', k, 2)), [9.3, 7.8]);
  assert.deepEqual([1, 2, 3].map(k => r.scoreFor('like', k, 3)), [9.5, 8.5, 7.5]);
  for (const s of Object.keys(r.SENTIMENTS)) {
    const { low, high } = r.SENTIMENTS[s];
    for (let k = 1; k <= 400; k++) {
      const v = r.scoreFor(s, k, 400);
      assert.ok(v >= low && v <= high, `${s} rank ${k} = ${v}`);
    }
  }
});

test('stars fill the old 1-5 column', () => {
  assert.deepEqual([0, 2.9, 5.5, 8.5, 10].map(r.starsFromScore), [1, 1, 3, 4, 5]);
});

test('binary search finds the right spot in few questions', () => {
  // existing list best -> worst, as "true quality" numbers
  const list = Array.from({ length: 399 }, (_, i) => 1000 - i);
  for (const newQuality of [2000, 1000.5, 800.5, 602.5, 0]) {
    let s = r.startSearch(list.length);
    let asked = 0;
    while (r.nextComparison(s) !== null) {
      s = r.applyAnswer(s, newQuality > list[r.nextComparison(s)]);
      asked++;
    }
    const expected = list.filter(q => q > newQuality).length + 1;
    assert.equal(r.finalRank(s), expected);
    assert.ok(asked <= 9, `asked ${asked}`);
  }
  // empty list: no questions, rank 1
  assert.equal(r.nextComparison(r.startSearch(0)), null);
  assert.equal(r.finalRank(r.startSearch(0)), 1);
});

test('skip stops the questions', () => {
  const s = r.skipSearch(r.startSearch(10));
  assert.equal(r.nextComparison(s), null);
  assert.equal(r.finalRank(s), 6);
});

test('sentiment must be one of the three thumbs', () => {
  assert.equal(r.parseSentiment('ok'), 'ok');
  for (const bad of ['', 'love', undefined, ['like'], 'toString']) {
    assert.throws(() => r.parseSentiment(bad), /thumbs/);
  }
});
