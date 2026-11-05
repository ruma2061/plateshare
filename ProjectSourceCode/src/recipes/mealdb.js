// TheMealDB client (#9): https://www.themealdb.com/api.php
// search(query) -> recipes shaped for our tables; lookup(mealId) -> one recipe or null.
// Any network/API problem becomes a MealDbError with a message safe to show users.
const axios = require('axios');

const BASE_URL = 'https://www.themealdb.com/api/json/v1';
const FRACTIONS = { '½': 1 / 2, '¼': 1 / 4, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 1 / 8 };

class MealDbError extends Error {}

const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

// "1.2 kg" -> {1.2, 'kg'} | "1 ½ tsp" -> {1.5, 'tsp'} | "1/2 cup" -> {0.5, 'cup'} | "To taste" -> {null, 'To taste'}
function parseMeasure(raw) {
  const text = clean(raw);
  if (!text) return { quantity: null, unit: null, notes: null };
  let quantity = null;
  let rest = text;
  let match;
  if ((match = text.match(/^(\d+)\s+(\d+)\/(\d+)(?=\D|$)/))) {           // 1 1/2
    quantity = Number(match[1]) + Number(match[2]) / Number(match[3]);
  } else if ((match = text.match(/^(\d+)\/(\d+)(?=\D|$)/))) {             // 1/2
    quantity = Number(match[1]) / Number(match[2]);
  } else if ((match = text.match(/^(\d+)?\s*([½¼¾⅓⅔⅛])/))) {              // 1 ½ or ½
    quantity = Number(match[1] || 0) + FRACTIONS[match[2]];
  } else if ((match = text.match(/^(\d+(?:\.\d+)?)/))) {                  // 300 / 1.5
    quantity = Number(match[1]);
  }
  if (match) rest = text.slice(match[0].length).trim();
  if (quantity !== null && (!Number.isFinite(quantity) || quantity > 99999999.99)) quantity = null;
  if (quantity !== null) quantity = Math.round(quantity * 100) / 100;
  // recipe_ingredients.unit is VARCHAR(30); longer text goes in notes instead.
  const unit = rest && rest.length <= 30 ? rest : null;
  const notes = rest && rest.length > 30 ? rest : null;
  return { quantity, unit, notes };
}

// One TheMealDB meal -> { mealdbId, title, description, directions, cuisine, imageUrl, sourceUrl, ingredients[] }
function toRecipe(meal) {
  const mealdbId = Number(meal?.idMeal);
  const title = clean(meal?.strMeal).slice(0, 150);
  if (!Number.isInteger(mealdbId) || mealdbId <= 0 || mealdbId > 2147483647 || !title) return null;

  // strIngredient1..20 + strMeasure1..20; skip blanks, merge repeats (PK is recipe+ingredient).
  const ingredients = new Map();
  for (let i = 1; i <= 20; i++) {
    const name = clean(meal[`strIngredient${i}`]).toLowerCase().slice(0, 100);
    if (!name) continue;
    const measure = parseMeasure(meal[`strMeasure${i}`]);
    if (ingredients.has(name)) {
      const existing = ingredients.get(name);
      const extra = clean(meal[`strMeasure${i}`]);
      if (extra) existing.notes = [existing.notes, `plus ${extra}`].filter(Boolean).join('; ');
    } else {
      ingredients.set(name, { name, ...measure });
    }
  }

  const directions = typeof meal.strInstructions === 'string'
    ? meal.strInstructions.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '';
  const httpsOrNull = value => (/^https?:\/\//i.test(clean(value)) ? clean(value) : null);
  const category = clean(meal.strCategory);

  return {
    mealdbId,
    title,
    description: category ? `${category} · from TheMealDB` : 'From TheMealDB',
    directions: directions || 'See the original recipe for directions.',
    cuisine: (clean(meal.strArea) || clean(meal.strCountry) || '').slice(0, 100) || null,
    imageUrl: httpsOrNull(meal.strMealThumb),
    sourceUrl: httpsOrNull(meal.strSource),
    ingredients: [...ingredients.values()],
  };
}

// `http` is injectable so tests never hit the real API.
function createMealDbClient({ apiKey = process.env.MEALDB_API_KEY, http = axios, timeoutMs = 5000 } = {}) {
  async function get(endpoint, params) {
    if (!apiKey) throw new MealDbError('Recipe import is not set up (missing MEALDB_API_KEY).');
    let response;
    try {
      response = await http.get(`${BASE_URL}/${encodeURIComponent(apiKey)}/${endpoint}`, { params, timeout: timeoutMs });
    } catch {
      throw new MealDbError("Couldn't reach TheMealDB right now. Please try again in a moment.");
    }
    const meals = response?.data?.meals;
    if (meals === null || meals === undefined) return []; // TheMealDB returns { meals: null } for no results
    if (!Array.isArray(meals)) throw new MealDbError('TheMealDB sent back something unexpected. Please try again.');
    return meals;
  }

  return {
    async search(query) {
      const q = clean(query).slice(0, 100);
      if (!q) return [];
      return (await get('search.php', { s: q })).map(toRecipe).filter(Boolean);
    },
    async lookup(mealId) {
      if (!/^\d{1,10}$/.test(String(mealId))) return null;
      const [meal] = await get('lookup.php', { i: String(mealId) });
      return meal ? toRecipe(meal) : null;
    },
  };
}

module.exports = { createMealDbClient, toRecipe, parseMeasure, MealDbError };
