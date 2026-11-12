const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');
let db, site;

before(async () => { db = await createDatabase(); site = await createSite(db); });
after(async () => { await site?.close(); await db?.engine.close(); });
beforeEach(async () => {
  await db.engine.exec(`
    TRUNCATE users, recipes, ratings, saved_recipes, ingredients RESTART IDENTITY CASCADE;
    INSERT INTO users (username, password_hash) VALUES ('alice', 'hash'), ('bob', 'hash');
    INSERT INTO recipes (user_id, title, directions) VALUES (1, 'Garden soup', 'Simmer.'), (2, 'Lemon pasta', 'Boil.');
    INSERT INTO recipes (title, directions, recipe_type) VALUES
      ('Official rice', 'Boil rice.', 'official'), ('Tacos', 'Fold.', 'official'), ('Pancakes', 'Flip.', 'official');
  `);
});

const myRatings = () => db.any(`SELECT recipe_id, sentiment, rank_position, score::float AS score, rating
  FROM ratings WHERE user_id = 1 ORDER BY sentiment, rank_position`);

test('first thumbs up saves straight away at 8.5 with no questions', async () => {
  const alice = await site.client(1);
  const res = await alice.request('/recipes/2/rate', { _csrf: alice.token, sentiment: 'like' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/recipes/2#rating');
  assert.deepEqual(await myRatings(), [{ recipe_id: 2, sentiment: 'like', rank_position: 1, score: 8.5, rating: 4 }]);
});

test('second thumbs up asks one question and ranks by the answer', async () => {
  const alice = await site.client(1);
  await alice.request('/recipes/4/rate', { _csrf: alice.token, sentiment: 'like' }); // Tacos
  const start = await alice.request('/recipes/5/rate', { _csrf: alice.token, sentiment: 'like' }); // Pancakes
  assert.equal(start.headers.get('location'), '/recipes/5/rate');
  const page = await (await alice.request('/recipes/5/rate')).text();
  assert.match(page, /Which was better/);
  assert.match(page, /Tacos/);
  const done = await alice.request('/recipes/5/rate/answer', { _csrf: alice.token, answer: 'better' });
  assert.equal(done.headers.get('location'), '/recipes/5#rating');
  assert.deepEqual((await myRatings()).map(r => [r.recipe_id, r.rank_position, r.score]), [[5, 1, 9.3], [4, 2, 7.8]]);
});

test('three recipes land at 9.5 / 8.5 / 7.5 and skip places in the middle', async () => {
  const alice = await site.client(1);
  const rate = (id, body) => alice.request(`/recipes/${id}/rate${body.answer ? '/answer' : ''}`, { _csrf: alice.token, ...body });
  await rate(4, { sentiment: 'like' });           // Tacos
  await rate(5, { sentiment: 'like' });           // Pancakes vs Tacos
  await rate(5, { answer: 'better' });
  await rate(3, { sentiment: 'like' });           // Rice: skip -> middle
  await rate(3, { answer: 'skip' });
  assert.deepEqual((await myRatings()).map(r => [r.recipe_id, r.score]), [[5, 9.5], [3, 8.5], [4, 7.5]]);
});

test('re-rating moves a recipe to another thumb group and rescores both', async () => {
  const alice = await site.client(1);
  await alice.request('/recipes/4/rate', { _csrf: alice.token, sentiment: 'like' });
  await alice.request('/recipes/5/rate', { _csrf: alice.token, sentiment: 'like' });
  await alice.request('/recipes/5/rate/answer', { _csrf: alice.token, answer: 'worse' });
  await alice.request('/recipes/4/rate', { _csrf: alice.token, sentiment: 'dislike' });
  assert.deepEqual((await myRatings()).map(r => [r.recipe_id, r.sentiment, r.score]),
    [[4, 'dislike', 2], [5, 'like', 8.5]]);
});


test('authors can rate their own recipe, bad input and CSRF are rejected', async () => {
  const alice = await site.client(1);

  const response = await alice.request('/recipes/1/rate', {
    _csrf: alice.token,
    sentiment: 'like'
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/recipes/1#rating');

  assert.equal(
    (await alice.request('/recipes/2/rate', {
      _csrf: alice.token,
      sentiment: 'love'
    })).status,
    400
  );

  assert.equal(
    (await alice.request('/recipes/2/rate', {
      sentiment: 'like'
    })).status,
    403
  );

  assert.deepEqual(await myRatings(), [
    {
      recipe_id: 1,
      sentiment: 'like',
      rank_position: 1,
      score: 8.5,
      rating: 4
    }
  ]);
});

test('guests are sent to login', async () => {
  const guest = await site.client();
  for (const [url, body] of [['/recipes/2/rate', {}], ['/recipes/2/rate'], ['/recipes/2/rate/answer', {}]]) {
    assert.equal((await guest.request(url, body)).headers.get('location'), '/login');
  }
});

test('recipe page shows thumb buttons, then the score once rated', async () => {
  const alice = await site.client(1);
  let html = await (await alice.request('/recipes/2')).text();
  assert.match(html, /You have not rated this recipe/);
  for (const v of ['like', 'ok', 'dislike']) assert.match(html, new RegExp(`name="sentiment" value="${v}"`));
  await alice.request('/recipes/2/rate', { _csrf: alice.token, sentiment: 'like' });
  html = await (await alice.request('/recipes/2')).text();
  assert.match(html, /8\.5 \/ 10/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(await (await alice.request('/recipes')).text(), /Your score: 8\.5 \/ 10/);
  // Authors can now rate their own recipes
  html = await (await alice.request('/recipes/1')).text();

  for (const v of ['like', 'ok', 'dislike']) {
    assert.match(html, new RegExp(`name="sentiment" value="${v}"`));
  }

  assert.doesNotMatch(html, /can’t rate it/);
});

test('comparison page shows both recipes as choices', async () => {
  const alice = await site.client(1);
  await alice.request('/recipes/4/rate', { _csrf: alice.token, sentiment: 'ok' });
  await alice.request('/recipes/5/rate', { _csrf: alice.token, sentiment: 'ok' });
  const html = await (await alice.request('/recipes/5/rate')).text();
  assert.match(html, /Which was better/);
  assert.match(html, /Just tried[\s\S]*Pancakes[\s\S]*Rated before[\s\S]*Tacos/);
  assert.match(html, /About 1 more question\./);
});

test('Rated tab and profile show 10-point scores sorted best first', async () => {
  const alice = await site.client(1);
  const rate = (id, body) => alice.request(`/recipes/${id}/rate${body.answer ? '/answer' : ''}`, { _csrf: alice.token, ...body });
  await rate(4, { sentiment: 'ok' });       // Tacos 5.5
  await rate(5, { sentiment: 'like' });     // Pancakes 8.5
  await rate(3, { sentiment: 'dislike' });  // Rice 2.0
  for (const url of ['/my-recipes?view=rated&sort=rating', '/profile/alice?view=rated&sort=rating']) {
    const html = await (await alice.request(url)).text();
    assert.match(html, /scores out of 10/, url);
    assert.match(html, /Pancakes[\s\S]*8\.5[\s\S]*Tacos[\s\S]*5\.5[\s\S]*Official rice[\s\S]*2\.0/, url);
    assert.doesNotMatch(html, /\/ 5</, url);
  }
});
