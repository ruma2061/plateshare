const { nutritionForDisplay } = require('./nutrition');

// Photos are bundled with the app; missing uploads never leave an empty card.
// These are category photographs, not photos of a particular user's dish.
const photoCategories = [
  ['seafood', 'Seafood', /\b(crab|salmon|fish|tuna|shrimp|seafood) cakes?\b/i],
  ['chicken', 'From the kitchen', /\b(chicken|turkey)(?: pot)? pies?\b/i],
  ['beef', 'Hearty favorites', /\b(?:shepherd|cottage)(?:['’]s)? pie\b|\b(meat|steak|beef|pork) pies?\b/i],
  ['cookies', 'Cookies & treats', /\b(cookie|cookies|brownie|brownies|biscotti|fudge|candy|candies|truffle|truffles)\b/i],
  ['cake', 'Something sweet', /\b(cake|cakes|cupcake|cupcakes|pie|pies|tart|tarts|cobbler|cheesecake|pudding|dessert|ice cream|mousse)\b/i],
  ['pizza', 'Pizza', /\b(pizza|pizzas|flatbread)\b/i],
  ['pasta', 'Pasta & noodles', /\b(pasta|fusilli|spaghetti|linguine|fettuccine|fettucine|farfalle|macaroni|penne|orzo|ravioli|lasagna|lasagne|tortellini|gnocchi|noodle|noodles|ramen)\b/i],
  ['soup', 'Soups & stews', /\b(soup|soups|stew|stews|chowder|bisque|gumbo|broth)\b|\bchili(?: con carne)?\s*$/i],
  ['breakfast', 'Breakfast', /\b(breakfast|brunch|pancake|pancakes|waffle|waffles|omelet|omelette|scrambled|french toast|frittata|quiche|eggs)\b/i],
  ['salad', 'Fresh salads', /\b(salad|salads|slaw|coleslaw)\b/i],
  ['bread', 'Breads & baking', /\b(bread|breads|roll|rolls|biscuit|biscuits|muffin|muffins|scone|scones|bagel|bagels|pretzel|pretzels|cornbread)\b/i],
  ['drinks', 'Drinks & smoothies', /\b(smoothie|smoothies|cocktail|cocktails|lemonade|margarita|mojito|sangria|latte|punch|milkshake|drink|drinks|juice)\b/i],
  ['rice', 'Rice & grains', /\b(rice|risotto|paella|pilaf|quinoa|couscous|biryani|jambalaya)\b/i],
  ['seafood', 'Seafood', /\b(fish|salmon|trout|tuna|cod|haddock|halibut|tilapia|shrimp|prawn|prawns|lobster|crab|scallop|scallops|mussel|mussels|clam|clams|seafood|crawfish)\b/i],
  ['chicken', 'From the kitchen', /\b(chicken|turkey|poultry|drumstick|drumsticks|drumettes|wings)\b/i],
  ['beef', 'Hearty favorites', /\b(beef|steak|steaks|burger|burgers|meatball|meatballs|meatloaf|lamb|pork|ham|bacon|sausage|ribs|brisket|tenderloin)\b/i],
  ['vegetables', 'Vegetables & sides', /\b(vegetable|vegetables|potato|potatoes|carrot|carrots|broccoli|cauliflower|spinach|greens|cabbage|squash|zucchini|pepper|peppers|beans|lentil|lentils|tofu)\b/i],
];

function recipeCopyForDisplay(value) {
  if (typeof value !== 'string') return null;
  // Imported source metadata stays in the database, out of the reading experience.
  const copy = value
    .replace(/^\s*(?:source|recipe source|original recipe)\s*:\s*(?:(?:https?:\/\/|www\.)\S+|[\w.-]+\.[a-z]{2,}(?:\/\S*)?)[ \t]*$/gim, '')
    .replace(/\b(?:https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|edu)(?:\/[^\s<>"']*)?)/gi, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return copy || null;
}

function presentRecipe(recipe) {
  let imageUrl = null;
  try {
    const url = new URL(recipe.image_url);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) imageUrl = url.href;
  } catch { /* Recipes may have no photo. */ }
  const [photo, categoryName] = photoCategories.find(([, , pattern]) => pattern.test(recipe.title || ''))
    || ['kitchen', 'From the community'];
  const fallbackImage = `/resources/images/recipes/${photo}.jpg`;
  const fallbackImageAlt = `Illustrative food photograph: ${categoryName.toLowerCase()}`;
  const hasTotalTime = recipe.prep_time != null || recipe.cook_time != null;
  return {
    ...recipe,
    description: recipeCopyForDisplay(recipe.description),
    directions: recipeCopyForDisplay(recipe.directions),
    image_url: imageUrl || fallbackImage, fallbackImage, fallbackImageAlt,
    imageAlt: imageUrl ? recipe.title : fallbackImageAlt,
    imageIsIllustrative: !imageUrl, categoryName,
    author: recipe.author || 'PlateShare',
    authorUrl: recipe.author ? `/profile/${encodeURIComponent(recipe.author)}` : null,
    hasTotalTime, totalMinutes: hasTotalTime ? Number(recipe.prep_time || 0) + Number(recipe.cook_time || 0) : null,
    ...nutritionForDisplay(recipe),
  };
}

module.exports = { presentRecipe, recipeCopyForDisplay };
