const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseNutrition, nutritionForDisplay } = require('../src/recipes/nutrition');

test('nutrition accepts zero and decimals while leaving blank measurements unknown', () => {
  assert.deepEqual(parseNutrition({ calories: '0', protein_g: '12.25', carbs_g: ' ', fat_g: '' }), {
    calories: 0, protein_g: 12.25, carbs_g: null, fat_g: null,
  });
  assert.deepEqual(parseNutrition({}), { calories: null, protein_g: null, carbs_g: null, fat_g: null });
});

test('nutrition rejects invalid input rather than coercing it into plausible measurements', () => {
  for (const bad of ['-1', 'NaN', 'Infinity', '12g', '1e3', '0x10', '1.234', '100000000', [], {}, true]) {
    assert.throws(() => parseNutrition({ calories: bad }), /Calories/);
  }
  assert.throws(() => parseNutrition({ protein_g: '-1' }), /Protein/);
  assert.throws(() => parseNutrition({ carbs_g: '-1' }), /Carbohydrates/);
  assert.throws(() => parseNutrition({ fat_g: '-1' }), /Fat/);
});

test('nutrition display distinguishes missing values from measured zero and supports partial data', () => {
  const display = nutritionForDisplay({ calories: '0.00', protein_g: null, carbs_g: '2.50', fat_g: null });
  assert.equal(display.hasNutrition, true);
  assert.deepEqual(display.nutrients.map(item => item.display), ['0 kcal', 'Not provided', '2.5 g', 'Not provided']);
  assert.equal(nutritionForDisplay({}).hasNutrition, false);
});
