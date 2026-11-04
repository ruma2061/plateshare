// Requires recipe alias r, author alias u, and viewer ID as parameter $1.
// Pending follow requests deliberately do not confer access.
const recipeVisibility = `(r.user_id IS NULL OR r.user_id = $1 OR NOT u.is_private
  OR EXISTS (SELECT 1 FROM follows access_follow
    WHERE access_follow.follower_id = $1 AND access_follow.following_id = r.user_id))`;

module.exports = { recipeVisibility };
