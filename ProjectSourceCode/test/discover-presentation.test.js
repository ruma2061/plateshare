const { test } = require('node:test');
const assert = require('node:assert/strict');
const { presentFeedRecipe } = require('../src/recipes/discover');

test('feed photos permit HTTPS but reject insecure URLs, credentials and executable schemes', () => {
  const secure = 'https://images.example.com/meal.jpg?size=large';
  assert.equal(presentFeedRecipe({ image_url: secure }).image_url, secure);
  for (const image_url of [null, '', 'http://example.com/meal.jpg', 'javascript:alert(1)', 'data:image/svg+xml,test', 'https://user:password@example.com/meal.jpg', '//example.com/meal.jpg']) {
    assert.equal(presentFeedRecipe({ image_url }).image_url, null);
  }
});

test('feed times preserve zero and distinguish missing measurements', () => {
  const recipe = presentFeedRecipe({ prep_time: 0, cook_time: 25, servings: 2 });
  assert.equal(recipe.prepLabel, '0 min');
  assert.equal(recipe.cookLabel, '25 min');
  assert.equal(recipe.servings, 2);
  const unknown = presentFeedRecipe({ prep_time: null, cook_time: null });
  assert.equal(unknown.prepLabel, 'Not provided');
  assert.equal(unknown.cookLabel, 'Not provided');
});

test('official recipes get an honest author fallback and author links are encoded', () => {
  assert.equal(presentFeedRecipe({}).author, 'PlateShare');
  assert.equal(presentFeedRecipe({}).authorUrl, null);
  assert.equal(presentFeedRecipe({ author: 'a/b' }).authorUrl, '/profile/a%2Fb');
});
