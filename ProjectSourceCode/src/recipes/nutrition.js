const FIELDS = [
  { name: 'calories', label: 'Calories', unit: 'kcal' },
  { name: 'protein_g', label: 'Protein', unit: 'g' },
  { name: 'carbs_g', label: 'Carbohydrates', unit: 'g' },
  { name: 'fat_g', label: 'Fat', unit: 'g' },
];

function parseNutrition(body) {
  return Object.fromEntries(FIELDS.map(({ name, label }) => {
    const raw = body[name];
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      return [name, null];
    }
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (!['string', 'number'].includes(typeof value) ||
        !/^\d+(\.\d{1,2})?$/.test(String(value)) ||
        !Number.isFinite(Number(value)) || Number(value) > 99999999.99) {
      throw new Error(`${label} must be a nonnegative number with at most two decimal places (maximum 99999999.99).`);
    }
    return [name, Number(value)];
  }));
}

function nutritionForDisplay(recipe) {
  const nutrients = FIELDS.map(field => {
    const value = recipe[field.name];
    const known = value !== undefined && value !== null;
    return { ...field, value: known ? value : '', display: known ? `${Number(value)} ${field.unit}` : 'Not provided' };
  });
  return { nutrients, hasNutrition: nutrients.some(item => item.value !== '') };
}

module.exports = { parseNutrition, nutritionForDisplay };
