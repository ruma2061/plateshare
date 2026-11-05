// Rating comparisons (#10)
// Flow: user picks a thumb -> binary search against their ranked list for
// that thumb -> recipe is inserted at a rank -> scores are recomputed.

// Each thumb owns a slice of the 0-10 scale.
const SENTIMENTS = {
  like:    { emoji: '👍', label: 'Liked it',       low: 7, high: 10 },
  ok:      { emoji: '👌', label: 'It was ok',      low: 4, high: 7 },
  dislike: { emoji: '👎', label: "Didn't like it", low: 0, high: 4 },
};

function parseSentiment(value) {
  if (typeof value !== 'string' || !Object.hasOwn(SENTIMENTS, value)) {
    throw new Error('Pick thumbs up, thumbs side or thumbs down.');
  }
  return value;
}

// rank 1 = best, n = how many recipes are in this thumb group.
// Spreads scores evenly; a lone recipe sits in the middle of its range.
function scoreFor(sentiment, rank, n) {
  const { low, high } = SENTIMENTS[sentiment];
  const raw = low + (high - low) * ((n - rank + 0.5) / n);
  return Math.round(raw * 10) / 10;
}

// Keeps the old 1-5 `rating` column filled so existing pages still work.
function starsFromScore(score) {
  return Math.min(5, Math.max(1, Math.round(score / 2)));
}

// ----- Binary search -----
// `list` is the user's group ordered best -> worst (index 0 = rank 1).
// The new recipe will be inserted somewhere in [low, high].
function startSearch(listLength) {
  return { low: 0, high: listLength };
}

// Index of the recipe to compare against next, or null when the spot is found.
function nextComparison({ low, high }) {
  return low < high ? Math.floor((low + high) / 2) : null;
}

// newIsBetter = user said the new recipe beats the one at nextComparison().
function applyAnswer(search, newIsBetter) {
  const mid = nextComparison(search);
  if (mid === null) return search;
  return newIsBetter ? { low: search.low, high: mid } : { low: mid + 1, high: search.high };
}

// "Skip": stop asking and drop it in the middle of what's left.
function skipSearch({ low, high }) {
  const spot = Math.floor((low + high) / 2);
  return { low: spot, high: spot };
}

// Final 1-based rank once nextComparison() returns null.
function finalRank({ low }) {
  return low + 1;
}

// What the recipe page needs to show the viewer's rating + the three thumb buttons.
// Expects recipe.user_score / user_sentiment / user_rating from the recipe query.
function ratingForDisplay(recipe) {
  const score = recipe.user_score == null ? null : Number(recipe.user_score);
  const sentiment = Object.hasOwn(SENTIMENTS, recipe.user_sentiment || '') ? recipe.user_sentiment : null;
  return {
    hasScore: score !== null,
    score: score === null ? null : score.toFixed(1),
    // Ratings saved before comparisons existed only have the 1-5 number.
    legacyStars: score === null && recipe.user_rating ? recipe.user_rating : null,
    sentiment: sentiment && { ...SENTIMENTS[sentiment] },
    options: Object.entries(SENTIMENTS).map(([value, s]) => ({
      value, emoji: s.emoji, label: s.label, active: value === sentiment,
    })),
  };
}

module.exports = {
  SENTIMENTS, ratingForDisplay, parseSentiment, scoreFor, starsFromScore,
  startSearch, nextComparison, applyAnswer, skipSearch, finalRank,
};
