const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { presentRecipe, recipeCopyForDisplay } = require('../src/recipes/presentation');
const { createDatabase } = require('./helpers/database');

test('recipe reading copy hides source metadata and raw URLs without altering useful text', () => {
  for (const source of ['Source: food52.com/recipes/123', 'Source: https://www.food.com/recipe/123', 'Source: www.food.com/recipe/123']) {
    assert.equal(recipeCopyForDisplay(source), null);
    assert.equal(recipeCopyForDisplay(`A family favorite.\n${source}`), 'A family favorite.');
  }
  assert.equal(recipeCopyForDisplay('Use fresh basil.\nSimmer for 5 minutes.'), 'Use fresh basil.\nSimmer for 5 minutes.');
  assert.equal(recipeCopyForDisplay('Source: my grandmother.'), 'Source: my grandmother.');
  assert.equal(recipeCopyForDisplay('Read https://example.com/recipe for more.'), 'Read  for more.');
});

test('recipes keep real photos and safely replace missing or unsafe URLs with bundled food photos', () => {
  const input = { title: 'Pasta for dinner', image_url: 'https://example.com/dinner.jpg', description: 'Source: www.food.com/recipe/1' };
  const shown = presentRecipe(input);
  assert.equal(shown.image_url, input.image_url);
  assert.equal(shown.imageIsIllustrative, false);
  assert.equal(shown.description, null);
  assert.equal(input.description, 'Source: www.food.com/recipe/1');
  for (const image_url of [undefined, '', 'javascript:alert(1)', 'data:image/svg+xml,test', 'https://user:password@example.com/dinner.jpg']) {
    const recipe = presentRecipe({ title: 'Lemon pasta', image_url });
    assert.equal(recipe.imageIsIllustrative, true);
    assert.equal(recipe.image_url, '/resources/images/recipes/pasta.jpg');
    assert.ok(existsSync(path.join(__dirname, '../src', recipe.image_url)));
  }
  const other = presentRecipe({ title: 'An old family favorite' });
  assert.ok(existsSync(path.join(__dirname, '../src', other.image_url)));
  for (const [title, category] of [['Crab Cakes', 'seafood'], ['Chicken Pot Pie', 'chicken'], ["Shepherd's Pie", 'beef'], ['Banana Bread', 'bread'], ['Rice Pudding', 'cake']]) {
    assert.equal(presentRecipe({ title }).image_url, `/resources/images/recipes/${category}.jpg`);
  }
});

test('the complete imported catalog has available local photos and no visible source URLs', async () => {
  const db = await createDatabase({ seed: true });
  try {
    const recipes = await db.any('SELECT * FROM recipes');
    assert.ok(recipes.length > 1000, 'Verify the complete imported catalog');
    for (const row of recipes) {
      const recipe = presentRecipe(row);
      assert.ok(existsSync(path.join(__dirname, '../src', recipe.image_url)), row.title);
      assert.equal(recipe.description, null, row.title);
    }
  } finally { await db.engine.close(); }
});
