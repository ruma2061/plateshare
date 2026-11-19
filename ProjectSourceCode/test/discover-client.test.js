const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

// Execute the actual browser script. Small DOM/observer doubles let these
// behavioral tests run without adding dependencies; they do not test layout.
const source = readFileSync(path.join(__dirname, '../src/resources/js/discover.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function mountFeed(fetchImpl) {
  const posts = [{ dataset: { recipeId: '10' } }];
  let next = { href: 'https://plateshare.example/discover?before=10' };
  let observed = null;
  let onIntersection;
  const listeners = {};
  const status = { textContent: '' };
  const attributes = {};
  const requests = [];
  const location = Object.freeze({ href: 'https://plateshare.example/discover', origin: 'https://plateshare.example' });
  const feed = {
    addEventListener(type, listener) { listeners[type] = listener; },
    setAttribute(name, value) { attributes[name] = value; },
    querySelector(selector) {
      if (selector === '[data-feed-next]') return next;
      if (selector === '[data-feed-pagination]') return { remove() { next = null; } };
      throw new Error(`Unexpected feed selector: ${selector}`);
    },
    querySelectorAll(selector) { return selector === '[data-recipe-id]' ? posts : []; },
    append(batch) { posts.push(...batch.posts); next = batch.next; },
  };
  const document = {
    activeElement: null,
    querySelector(selector) { return selector === '[data-discover-feed]' ? feed : status; },
  };
  const env = {
    document, location, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    window: { IntersectionObserver: true },
    IntersectionObserver: class {
      constructor(callback) { onIntersection = callback; }
      observe(target) { observed = target; }
      disconnect() { observed = null; }
    },
    DOMParser: class {
      parseFromString(html) {
        const data = JSON.parse(html); // Stub only HTML parsing, not client behavior.
        const batch = {
          posts: data.ids.map(id => ({ dataset: { recipeId: String(id) }, remove() { batch.posts = batch.posts.filter(post => post !== this); } })),
          next: data.before ? { href: `${location.origin}/discover?before=${data.before}` } : null,
          querySelectorAll() { return [...this.posts]; },
        };
        return { querySelector() { return batch; } };
      }
    },
    fetch: async (url, options) => { requests.push({ url: String(url), options }); return fetchImpl(url, options); },
  };
  runInNewContext(source, env, { filename: 'discover.js' });
  return {
    posts, requests, status, attributes, location,
    intersect() { if (observed) onIntersection([{ isIntersecting: true }]); },
    retry() {
      let prevented = false;
      listeners.click({ target: { closest() { return next; } }, button: 0, preventDefault() { prevented = true; } });
      return prevented;
    },
    get next() { return next; },
  };
}

const batchResponse = (ids, before = null) => ({
  ok: true, status: 200,
  headers: { get() { return 'text/html; charset=utf-8'; } },
  text: async () => JSON.stringify({ ids, before }),
});

test('scrolling appends multiple batches without navigating and stops at the end', async () => {
  const responses = [batchResponse([9, 8], 8), batchResponse([7])];
  const app = mountFeed(async () => responses.shift());
  app.intersect();
  await settle();
  app.intersect();
  await settle();
  assert.deepEqual(app.posts.map(post => post.dataset.recipeId), ['10', '9', '8', '7']);
  assert.equal(app.location.href, 'https://plateshare.example/discover');
  assert.deepEqual(app.requests.map(request => request.url), [
    'https://plateshare.example/discover/feed?before=10',
    'https://plateshare.example/discover/feed?before=8',
  ]);
  assert.equal(app.next, null);
  app.intersect();
  assert.equal(app.requests.length, 2);
  assert.equal(app.attributes['aria-busy'], 'false');
  assert.equal(app.requests[0].options.credentials, 'same-origin');
  assert.equal(app.requests[0].options.redirect, 'error');
});

test('repeated scroll notifications cannot issue concurrent pagination requests', async () => {
  let resolve;
  const app = mountFeed(() => new Promise(done => { resolve = done; }));
  app.intersect();
  app.intersect();
  app.retry();
  assert.equal(app.requests.length, 1);
  assert.equal(app.attributes['aria-busy'], 'true');
  resolve(batchResponse([9]));
  await settle();
  assert.equal(app.attributes['aria-busy'], 'false');
});

test('a failed batch retains posts, shows a message and waits for a manual retry', async () => {
  let attempts = 0;
  const app = mountFeed(async () => ++attempts === 1 ? { ok: false, status: 500 } : batchResponse([9]));
  app.intersect();
  await settle();
  assert.match(app.status.textContent, /request failed.*retry/i);
  assert.deepEqual(app.posts.map(post => post.dataset.recipeId), ['10']);
  assert.ok(app.next);
  app.intersect();
  assert.equal(app.requests.length, 1);
  assert.equal(app.retry(), true, 'Retry must prevent ordinary page navigation');
  await settle();
  assert.equal(app.requests.length, 2);
  assert.deepEqual(app.posts.map(post => post.dataset.recipeId), ['10', '9']);
});

test('empty later batches and expired sessions produce messages instead of blank content', async () => {
  const empty = mountFeed(async () => batchResponse([]));
  empty.intersect();
  await settle();
  assert.match(empty.status.textContent, /caught up/);
  assert.equal(empty.posts.length, 1);
  const expired = mountFeed(async () => ({ ok: false, status: 401 }));
  expired.intersect();
  await settle();
  assert.match(expired.status.textContent, /session expired/i);
  assert.equal(expired.posts.length, 1);
});
