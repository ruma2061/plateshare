const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');
const { parseComment } = require('../src/recipes/comments');
let db, site;

before(async () => { db = await createDatabase(); site = await createSite(db); });
after(async () => { await site?.close(); await db?.engine.close(); });
beforeEach(async () => {
  await db.engine.exec(`TRUNCATE users, recipes, ingredients RESTART IDENTITY CASCADE;
    INSERT INTO users (username, password_hash) VALUES ('alice', 'hash'), ('bob', 'hash');
    INSERT INTO recipes (user_id, title, directions) VALUES (1, 'Soup', 'Simmer.'), (2, 'Pasta', 'Boil.');
    INSERT INTO recipes (title, directions, recipe_type) VALUES ('Official rice', 'Cook.', 'official');`);
});

test('comments persist, show the session author, and refresh does not insert again', async () => {
  const alice = await site.client(1);
  const empty = await (await alice.request('/recipes/2')).text();
  assert.match(empty, /No comments yet/);
  const response = await alice.request('/recipes/2/comments', { _csrf: alice.token, body: '  Delicious!\nThank you.  ', user_id: '2', recipe_id: '1' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/recipes/2#comments');
  assert.deepEqual(await db.any('SELECT recipe_id, user_id, body FROM recipe_comments'), [
    { recipe_id: 2, user_id: 1, body: 'Delicious!\nThank you.' },
  ]);
  const fresh = await site.client(1);
  const html = await (await fresh.request('/recipes/2')).text();
  assert.match(html, /Delicious!\nThank you\./);
  assert.match(html, /href="\/profile\/alice"/);
  assert.match(html, /Comments \(1\)/);
  await fresh.request('/recipes/2');
  assert.equal((await db.one('SELECT COUNT(*)::int AS count FROM recipe_comments')).count, 1);
  assert.equal((await fresh.request('/recipes/1/comments', { _csrf: fresh.token, body: 'My own recipe' })).status, 303);
  assert.equal((await fresh.request('/recipes/3/comments', { _csrf: fresh.token, body: 'Official recipe' })).status, 303);
});

test('invalid bodies are rejected without inserts and valid Unicode is accepted', async () => {
  const alice = await site.client(1);
  for (const body of ['', ' \t\n ', 'x'.repeat(2001), 'bad\0text']) {
    const response = await alice.request('/recipes/1/comments', { _csrf: alice.token, body });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Enter a comment between/);
  }
  assert.equal((await alice.request('/recipes/1/comments', { _csrf: alice.token })).status, 400);
  assert.equal((await alice.request('/recipes/1/comments', { _csrf: alice.token, 'body[x]': 'text' })).status, 400);
  assert.equal((await db.one('SELECT COUNT(*)::int AS count FROM recipe_comments')).count, 0);
  assert.equal(parseComment({}), null);
  assert.equal(parseComment(['text']), null);
  assert.equal(parseComment('😀'.repeat(2000)), '😀'.repeat(2000));
  assert.equal((await alice.request('/recipes/1/comments', { _csrf: alice.token, body: '😀'.repeat(2000) })).status, 303);
});

test('guests and invalid CSRF tokens cannot post', async () => {
  const guest = await site.client();
  const response = await guest.request('/recipes/1/comments', { body: 'hello' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');
  const alice = await site.client(1), bob = await site.client(2);
  for (const token of ['', bob.token]) {
    assert.equal((await alice.request('/recipes/1/comments', { body: 'hello', _csrf: token })).status, 403);
  }
  assert.equal((await db.one('SELECT COUNT(*)::int AS count FROM recipe_comments')).count, 0);
});

test('missing recipes and private recipes hide comments and reject writes until following', async () => {
  await db.none('INSERT INTO recipe_comments (recipe_id, user_id, body) VALUES (2, 2, $1)', ['Private discussion']);
  await db.none('UPDATE users SET is_private = TRUE WHERE user_id = 2');
  await db.none('INSERT INTO follow_requests (requester_id, recipient_id) VALUES (1, 2)');
  const alice = await site.client(1);
  for (const id of ['0', '-1', '1oops', '9999999999999', '999', '2']) {
    const page = await alice.request(`/recipes/${id}`);
    assert.equal(page.status, 404);
    assert.doesNotMatch(await page.text(), /Private discussion/);
    assert.equal((await alice.request(`/recipes/${id}/comments`, { _csrf: alice.token, body: 'hello' })).status, 404);
  }
  const bob = await site.client(2);
  assert.equal((await bob.request('/recipes/2/comments', { _csrf: bob.token, body: 'Owner reply' })).status, 303);
  await db.none('INSERT INTO follows (follower_id, following_id) VALUES (1, 2)');
  assert.match(await (await alice.request('/recipes/2')).text(), /Private discussion/);
  assert.equal((await alice.request('/recipes/2/comments', { _csrf: alice.token, body: 'Follower reply' })).status, 303);
  await db.none('DELETE FROM follows WHERE follower_id = 1 AND following_id = 2');
  assert.equal((await alice.request('/recipes/2')).status, 404);
});

test('HTML and SQL-like comments remain escaped text and validation preserves input', async () => {
  const alice = await site.client(1);
  const body = '<script>alert(1)</script> \' OR 1=1 --';
  assert.equal((await alice.request('/recipes/1/comments', { _csrf: alice.token, body })).status, 303);
  const html = await (await alice.request('/recipes/1')).text();
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  const invalid = await alice.request('/recipes/1/comments', { _csrf: alice.token, body: '<b>' + 'x'.repeat(2000) });
  assert.equal(invalid.status, 400);
  assert.match(await invalid.text(), /&lt;b&gt;/);
  assert.equal((await db.one('SELECT COUNT(*)::int AS count FROM recipe_comments')).count, 1);
});

test('comment pagination is bounded, stable, and does not mix recipes', async () => {
  await db.none(`INSERT INTO recipe_comments (recipe_id, user_id, body, created_at)
    SELECT 1, 1, 'Message ' || n, '2026-01-01'::timestamptz FROM generate_series(1, 51) n`);
  await db.none("INSERT INTO recipe_comments (recipe_id, user_id, body) VALUES (2, 2, 'Other recipe')");
  const alice = await site.client(1);
  const first = await (await alice.request('/recipes/1')).text();
  assert.match(first, /Message 51/);
  assert.doesNotMatch(first, /Message 1<|Other recipe/);
  assert.match(first, /Older comments/);
  const last = await (await alice.request('/recipes/1?commentsPage=99999')).text();
  assert.match(last, /Message 1</);
  assert.doesNotMatch(last, /Message 51/);
  assert.match(last, /Newer comments/);
  for (const query of ['commentsPage=-1', 'commentsPage=abc', 'commentsPage[x]=1']) {
    assert.equal((await alice.request(`/recipes/1?${query}`)).status, 200);
  }
});

test('schema upgrade is repeatable, enforces constraints and cascades recipe deletion', async () => {
  await db.engine.exec(await readFile(path.join(__dirname, '../src/init_data/zz_004_recipe_comments.sql'), 'utf8'));
  for (const body of ['', '   ', 'x'.repeat(2001)]) {
    await assert.rejects(db.none('INSERT INTO recipe_comments (recipe_id, user_id, body) VALUES (1, 1, $1)', [body]));
  }
  await db.none("INSERT INTO recipe_comments (recipe_id, user_id, body) VALUES (1, 1, 'hello')");
  await db.none('DELETE FROM recipes WHERE recipe_id = 1');
  assert.equal((await db.one('SELECT COUNT(*)::int AS count FROM recipe_comments')).count, 0);
});

test('database failures return a helpful error without leaking comment text or SQL', async () => {
  const alice = await site.client(1);
  await db.none('ALTER TABLE recipe_comments RENAME TO unavailable_comments');
  try {
    const response = await alice.request('/recipes/1/comments', { _csrf: alice.token, body: 'Sensitive comment' });
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /Sensitive comment|INSERT INTO|does not exist/);
  } finally {
    await db.none('ALTER TABLE unavailable_comments RENAME TO recipe_comments');
  }
});
