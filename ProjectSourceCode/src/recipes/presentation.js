const { nutritionForDisplay } = require('./nutrition');

function presentRecipe(recipe) {
  let imageUrl = null;
  try {
    const url = new URL(recipe.image_url);
    if (['http:', 'https:'].includes(url.protocol)) imageUrl = url.href;
  } catch { /* Recipes may have no photo. */ }
  const hasTotalTime = recipe.prep_time != null || recipe.cook_time != null;
  return {
    ...recipe, image_url: imageUrl, author: recipe.author || 'PlateShare',
    authorUrl: recipe.author ? `/profile/${encodeURIComponent(recipe.author)}` : null,
    hasTotalTime, totalMinutes: hasTotalTime ? Number(recipe.prep_time || 0) + Number(recipe.cook_time || 0) : null,
    ...nutritionForDisplay(recipe),
  };
}

module.exports = { presentRecipe };
