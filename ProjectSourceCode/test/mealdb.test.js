const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMealDbClient, toRecipe, parseMeasure, MealDbError } = require('../src/recipes/mealdb');

// Trimmed from a real TheMealDB search.php?s=chicken response
const blanks = from => Object.fromEntries(Array.from({ length: 21 - from }, (_, k) => [
  [`strIngredient${from + k}`, ''], [`strMeasure${from + k}`, ' '],
]).flat());
const handi = {
  idMeal: '52795', strMeal: 'Chicken Handi', strCategory: 'Chicken', strArea: 'India', strCountry: 'India',
  strInstructions: 'Heat the oil.\r\nAdd onion.\r\n\r\n\r\nServe hot.',
  strMealThumb: 'https://www.themealdb.com/images/media/meals/wyxwsp1486979827.jpg', strSource: '',
  strIngredient1: 'Chicken', strMeasure1: '1.2 kg', strIngredient2: 'Onion', strMeasure2: '5 thinly sliced',
  strIngredient3: 'Vegetable oil', strMeasure3: '¼ cup', strIngredient4: 'Salt', strMeasure4: 'To taste', ...blanks(5),
};
const lollipop = {
  idMeal: '53565', strMeal: 'Chicken Lollipop', strCategory: 'Chicken', strArea: null, strCountry: 'Dominica',
  strInstructions: 'Fry.', strMealThumb: 'https://www.themealdb.com/images/media/meals/nz0lg71784671684.jpg',
  strSource: 'https://dominicagourmet.com/chicken-lollipop-recipe/',
  strIngredient1: 'Chicken Wings', strMeasure1: '2 Lbs', ...blanks(2),
};
const parmentier = {
  idMeal: '52879', strMeal: 'Chicken Parmentier', strCategory: 'Chicken', strArea: 'France',
  strInstructions: 'Bake.', strMealThumb: 'https://www.themealdb.com/images/media/meals/uwvxpv1511557015.jpg',
  strIngredient1: 'Butter', strMeasure1: '30g', strIngredient2: 'Potatoes', strMeasure2: '1.5kg',
  strIngredient3: 'Butter', strMeasure3: '30g', ...blanks(4),
};

test('measures split into quantity + unit', () => {
  const cases = {
    '1.2 kg': [1.2, 'kg'], '300g': [300, 'g'], '¼ cup': [0.25, 'cup'], '1 ½ tsp': [1.5, 'tsp'],
    '1/2 tsp': [0.5, 'tsp'], '1 1/2 cups': [1.5, 'cups'], '2/3 Cup': [0.67, 'Cup'], 'To taste': [null, 'To taste'],
    'pinch': [null, 'pinch'], '8': [8, null], '  ': [null, null],
  };
  for (const [raw, [quantity, unit]] of Object.entries(cases)) {
    const parsed = parseMeasure(raw);
    assert.equal(parsed.quantity, quantity, raw);
    assert.equal(parsed.unit, unit, raw);
  }
  // too long for the VARCHAR(30) unit column -> notes
  assert.deepEqual(parseMeasure('4 pounded to 1cm thickness then halved'),
    { quantity: 4, unit: null, notes: 'pounded to 1cm thickness then halved' });
});

test('a meal maps to our recipe shape and skips blank ingredient slots', () => {
  const recipe = toRecipe(handi);
  assert.equal(recipe.mealdbId, 52795);
  assert.equal(recipe.title, 'Chicken Handi');
  assert.equal(recipe.cuisine, 'India');
  assert.equal(recipe.description, 'Chicken · from TheMealDB');
  assert.equal(recipe.directions, 'Heat the oil.\nAdd onion.\n\nServe hot.');
  assert.match(recipe.imageUrl, /^https:\/\/www\.themealdb\.com/);
  assert.equal(recipe.sourceUrl, null);
  assert.deepEqual(recipe.ingredients.map(i => i.name), ['chicken', 'onion', 'vegetable oil', 'salt']);
  assert.deepEqual(recipe.ingredients[1], { name: 'onion', quantity: 5, unit: 'thinly sliced', notes: null });
});

test('null area falls back to country; repeated ingredients merge instead of breaking the primary key', () => {
  assert.equal(toRecipe(lollipop).cuisine, 'Dominica');
  assert.equal(toRecipe(lollipop).sourceUrl, 'https://dominicagourmet.com/chicken-lollipop-recipe/');
  const recipe = toRecipe(parmentier);
  assert.deepEqual(recipe.ingredients.map(i => i.name), ['butter', 'potatoes']);
  assert.equal(recipe.ingredients[0].notes, 'plus 30g');
  assert.equal(toRecipe({ idMeal: 'abc', strMeal: 'X' }), null);
  assert.equal(toRecipe({ idMeal: '1', strMeal: '  ' }), null);
});

test('search calls the API with the key from config and maps results', async () => {
  const calls = [];
  const http = { get: async (url, options) => { calls.push([url, options.params]); return { data: { meals: [handi, lollipop] } }; } };
  const results = await createMealDbClient({ apiKey: '1', http }).search('  chicken ');
  assert.deepEqual(results.map(r => r.title), ['Chicken Handi', 'Chicken Lollipop']);
  assert.deepEqual(calls, [['https://www.themealdb.com/api/json/v1/1/search.php', { s: 'chicken' }]]);
});

test('no results, blank queries and bad IDs return empty without errors', async () => {
  let called = 0;
  const http = { get: async () => { called++; return { data: { meals: null } }; } };
  const client = createMealDbClient({ apiKey: '1', http });
  assert.deepEqual(await client.search('zzzz'), []);
  assert.equal(await client.lookup('99999'), null);
  assert.deepEqual(await client.search('   '), []);
  assert.equal(await client.lookup('1; DROP TABLE'), null);
  assert.equal(called, 2);
});

test('API failures become a friendly MealDbError instead of crashing', async () => {
  const down = createMealDbClient({ apiKey: '1', http: { get: async () => { throw new Error('ECONNRESET'); } } });
  await assert.rejects(down.search('chicken'), err => err instanceof MealDbError && /Couldn't reach TheMealDB/.test(err.message));
  const weird = createMealDbClient({ apiKey: '1', http: { get: async () => ({ data: { meals: 'Invalid' } }) } });
  await assert.rejects(weird.search('chicken'), MealDbError);
  const noKey = createMealDbClient({ apiKey: '', http: { get: async () => assert.fail('should not call API') } });
  await assert.rejects(noKey.search('chicken'), /missing MEALDB_API_KEY/);
});
