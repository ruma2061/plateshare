const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase, applySchema } = require('./helpers/database');
let db;

before(async () => {
  // Seed the old schema first, then upgrade it exactly like an existing install.
  db = await createDatabase({ baseOnly: true });
  await db.none("INSERT INTO users (username, password_hash) VALUES ('cook', 'hash')");
  await db.none("INSERT INTO recipes (user_id, title, directions) VALUES (1, 'Soup', 'Simmer')");
  await db.none('INSERT INTO ratings (user_id, recipe_id, rating) VALUES (1, 1, 4)');
  await applySchema(db.engine);
});
after(async () => { await db?.engine.close(); });

test('nutrition is optional and preserves zero; the database rejects negative or nonfinite values', async () => {
  const recipe = await db.one('SELECT calories, protein_g, carbs_g, fat_g FROM recipes WHERE recipe_id = 1');
  assert.deepEqual(recipe, { calories: null, protein_g: null, carbs_g: null, fat_g: null });
  await db.none('UPDATE recipes SET calories = 0, protein_g = 2.5 WHERE recipe_id = 1');
  assert.equal(Number((await db.one('SELECT calories FROM recipes WHERE recipe_id = 1')).calories), 0);
  for (const value of [-1, 'NaN', 'Infinity', 100000000]) {
    await assert.rejects(db.none('UPDATE recipes SET fat_g = $1 WHERE recipe_id = 1', [value]));
  }
});

test('saved recipes cannot duplicate and are removed with their recipe', async () => {
  await db.none("INSERT INTO recipes (title, directions, recipe_type) VALUES ('Official soup', 'Simmer', 'official')");
  await db.none('INSERT INTO saved_recipes (user_id, recipe_id) VALUES (1, 2)');
  await assert.rejects(db.none('INSERT INTO saved_recipes (user_id, recipe_id) VALUES (1, 2)'), { code: '23505' });
  await assert.rejects(db.none('INSERT INTO saved_recipes (user_id, recipe_id) VALUES (1, 999)'), { code: '23503' });
  await db.none('DELETE FROM recipes WHERE recipe_id = 2');
  assert.equal((await db.one('SELECT COUNT(*)::int AS count FROM saved_recipes')).count, 0);
});

test('reapplying initialization and migration preserves accounts, recipes, ratings and saves', async () => {
  await db.none('INSERT INTO saved_recipes (user_id, recipe_id) VALUES (1, 1)');
  await applySchema(db.engine);
  assert.equal((await db.one('SELECT username FROM users WHERE user_id = 1')).username, 'cook');
  assert.equal((await db.one('SELECT rating FROM ratings WHERE recipe_id = 1')).rating, 4);
  assert.equal((await db.one('SELECT COUNT(*)::int AS count FROM saved_recipes')).count, 1);
});
