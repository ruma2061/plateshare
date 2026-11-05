const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');
const { toRecipe, MealDbError } = require('../src/recipes/mealdb');

const meal = (id, name, ingredients) => ({
  idMeal: String(id), strMeal: name, strCategory: 'Chicken', strArea: 'India',
  strInstructions: 'Cook it.', strMealThumb: `https://www.themealdb.com/images/media/meals/${id}.jpg`,
  ...Object.fromEntries(ingredients.flatMap(([n, m], i) => [[`strIngredient${i + 1}`, n], [`strMeasure${i + 1}`, m]])),
});
const MEALS = {
  52795: meal(52795, 'Chicken Handi', [['Chicken', '1.2 kg'], ['Garlic', '8 cloves'], ['Salt', 'To taste']]),
  52831: meal(52831, 'Chicken Karaage', [['Chicken', '450 grams'], ['Soy sauce', '2 tablespoons']]),
};
// Fake TheMealDB: `down` flips it into failure mode.
const fake = { down: false, calls: 0 };
const mealDb = {
  async search(q) {
    fake.calls++;
    if (fake.down) throw new MealDbError("Couldn't reach TheMealDB right now. Please try again in a moment.");
    return Object.values(MEALS).filter(m => m.strMeal.toLowerCase().includes(q.toLowerCase())).map(toRecipe);
  },
  async lookup(id) {
    fake.calls++;
    if (fake.down) throw new MealDbError("Couldn't reach TheMealDB right now. Please try again in a moment.");
    return MEALS[id] ? toRecipe(MEALS[id]) : null;
  },
};

let db, site;
before(async () => { db = await createDatabase(); site = await createSite(db, { mealDb }); });
after(async () => { await site?.close(); await db?.engine.close(); });
beforeEach(async () => {
  fake.down = false; fake.calls = 0;
  await db.engine.exec(`
    TRUNCATE users, recipes, ratings, saved_recipes, ingredients RESTART IDENTITY CASCADE;
    INSERT INTO users (username, password_hash) VALUES ('alice', 'hash');
    INSERT INTO recipes (title, directions, recipe_type) VALUES ('Official rice', 'Boil rice.', 'official');
    INSERT INTO ingredients (name) VALUES ('garlic');
  `);
});

test('search shows TheMealDB results with photos and import buttons', async () => {
  const alice = await site.client(1);
  const html = await (await alice.request('/recipes/import?q=chicken')).text();
  assert.match(html, /2 results for “chicken”/);
  assert.match(html, /Chicken Handi[\s\S]*Chicken Karaage/);
  assert.match(html, /themealdb\.com\/images\/media\/meals\/52795\.jpg/);
  assert.match(html, /action="\/recipes\/import\/52795"/);
  assert.match(await (await alice.request('/recipes')).text(), /href="\/recipes\/import"/);
});

test('import saves an official recipe with ingredients, reusing existing ingredient rows', async () => {
  const alice = await site.client(1);
  const res = await alice.request('/recipes/import/52795', { _csrf: alice.token });
  assert.equal(res.status, 303);
  const recipe = await db.one("SELECT * FROM recipes WHERE mealdb_id = 52795");
  assert.equal(res.headers.get('location'), `/recipes/${recipe.recipe_id}`);
  assert.equal(recipe.recipe_type, 'official');
  assert.equal(recipe.user_id, null);
  assert.equal(recipe.cuisine, 'India');
  assert.match(recipe.image_url, /52795\.jpg$/);
  const ingredients = await db.any(`SELECT i.ingredient_id, i.name, ri.quantity::float AS quantity, ri.unit FROM recipe_ingredients ri
    JOIN ingredients i USING (ingredient_id) WHERE ri.recipe_id = $1 ORDER BY i.name`, [recipe.recipe_id]);
  assert.deepEqual(ingredients.map(i => [i.name, i.quantity, i.unit]),
    [['chicken', 1.2, 'kg'], ['garlic', 8, 'cloves'], ['salt', null, 'To taste']]);
  assert.equal(ingredients.find(i => i.name === 'garlic').ingredient_id, 1); // reused the seed row
  // shows up like any other recipe, and can be rated
  const page = await (await alice.request(`/recipes/${recipe.recipe_id}`)).text();
  assert.match(page, /Chicken Handi/);
  assert.match(page, /name="sentiment" value="like"/);
});

test('importing twice does not duplicate; search then says it is already on PlateShare', async () => {
  const alice = await site.client(1);
  await alice.request('/recipes/import/52795', { _csrf: alice.token });
  const again = await alice.request('/recipes/import/52795', { _csrf: alice.token });
  assert.equal(again.status, 303);
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM recipes WHERE mealdb_id = 52795')).n, 1);
  const html = await (await alice.request('/recipes/import?q=chicken')).text();
  assert.match(html, /Already on PlateShare/);
  assert.match(html, /action="\/recipes\/import\/52831"/);
});

test('when TheMealDB is down the page shows an error instead of crashing', async () => {
  const alice = await site.client(1);
  fake.down = true;
  const search = await alice.request('/recipes/import?q=chicken');
  assert.equal(search.status, 502);
  assert.match(await search.text(), /Couldn(&#x27;|')t reach TheMealDB/);
  const imp = await alice.request('/recipes/import/52795', { _csrf: alice.token });
  assert.equal(imp.status, 502);
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM recipes')).n, 1);
  // the rest of the site still works
  assert.equal((await alice.request('/recipes')).status, 200);
});

test('empty search does not call the API; bad IDs, unknown meals, missing CSRF and guests are rejected', async () => {
  const alice = await site.client(1);
  assert.equal((await alice.request('/recipes/import')).status, 200);
  assert.equal(fake.calls, 0);
  assert.equal((await alice.request('/recipes/import/abc', { _csrf: alice.token })).status, 404);
  assert.equal((await alice.request('/recipes/import/99999', { _csrf: alice.token })).status, 404);
  assert.equal((await alice.request('/recipes/import/52795', {})).status, 403);
  const guest = await site.client();
  assert.equal((await guest.request('/recipes/import?q=x')).headers.get('location'), '/login');
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM recipes')).n, 1);
});
