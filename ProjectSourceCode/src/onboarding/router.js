const express = require('express');
const auth = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const { recipeVisibility } = require('../recipes/visibility');
const { parseProfileDetails } = require('./profile');

function createOnboardingRouter(db) {
  const router = express.Router();
  const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const isComplete = async userId => {
    const user = await db.one('SELECT onboarding_completed FROM users WHERE user_id = $1', [userId]);
    return user.onboarding_completed;
  };
  router.use('/onboarding', auth);

  router.get('/onboarding', asyncRoute(async (req, res) => {
    if (await isComplete(req.session.user.user_id)) return res.redirect('/recipes');
    return res.redirect('/onboarding/profile');
  }));

  router.get('/onboarding/profile', asyncRoute(async (req, res) => {
    if (await isComplete(req.session.user.user_id)) return res.redirect('/recipes');
    const profileUser = await db.one(
      'SELECT username, display_name, bio, avatar_url, is_private FROM users WHERE user_id = $1',
      [req.session.user.user_id]
    );
    return res.render('pages/onboarding', {
      title: 'Set up your profile', isProfile: true,
      profileUser: { ...profileUser, display_name: profileUser.display_name || profileUser.username },
    });
  }));

  router.post('/onboarding/profile', verifyCsrf, asyncRoute(async (req, res) => {
    const userId = req.session.user.user_id;
    if (await isComplete(userId)) return res.redirect(303, '/recipes');
    let profile;
    try {
      profile = parseProfileDetails(req.body);
      if (!['true', 'false'].includes(req.body.is_private)) {
        throw new Error('Choose public or private.');
      }
    } catch (error) {
      return res.status(400).render('pages/onboarding', {
        title: 'Set up your profile', isProfile: true, error: error.message,
        profileUser: { username: req.session.user.username,
          display_name: req.body.display_name, bio: req.body.bio,
          avatar_url: req.body.avatar_url, is_private: req.body.is_private === 'true' },
      });
    }
    await db.none(`UPDATE users SET display_name = $1, bio = $2, avatar_url = $3,
      is_private = $4 WHERE user_id = $5`,
      [profile.displayName, profile.bio, profile.avatarUrl, req.body.is_private === 'true', userId]);
    return res.redirect(303, '/onboarding/friends');
  }));

  router.get('/onboarding/friends', asyncRoute(async (req, res) => {
    if (await isComplete(req.session.user.user_id)) return res.redirect('/recipes');
    const profiles = await db.any(`SELECT u.user_id, u.username, u.display_name, u.is_private,
      (f.follower_id IS NOT NULL) AS is_following,
      (fr.requester_id IS NOT NULL) AS request_pending
      FROM users u
      LEFT JOIN follows f ON f.follower_id = $1 AND f.following_id = u.user_id
      LEFT JOIN follow_requests fr ON fr.requester_id = $1 AND fr.recipient_id = u.user_id
      WHERE u.user_id <> $1 ORDER BY u.created_at DESC, u.user_id DESC LIMIT 12`,
      [req.session.user.user_id]);
    return res.render('pages/onboarding', {
      title: 'Find cooks to follow', isFriends: true, profiles,
    });
  }));

  router.post('/onboarding/friends/continue', verifyCsrf, asyncRoute(async (req, res) => {
    return res.redirect(303, '/onboarding/taste');
  }));

  router.get('/onboarding/taste', asyncRoute(async (req, res) => {
    if (await isComplete(req.session.user.user_id)) return res.redirect('/recipes');
    const recipes = await db.any(`SELECT r.recipe_id, r.title, r.image_url,
      COALESCE(u.display_name, u.username, 'PlateShare') AS author
      FROM recipes r
      LEFT JOIN users u ON u.user_id = r.user_id
      LEFT JOIN ratings mine ON mine.recipe_id = r.recipe_id AND mine.user_id = $1
      WHERE mine.rating_id IS NULL AND ${recipeVisibility}
      ORDER BY r.is_featured DESC, r.created_at DESC, r.recipe_id DESC LIMIT 10`,
      [req.session.user.user_id]);
    return res.render('pages/onboarding', {
      title: 'Build your taste profile', isTaste: true, recipes,
    });
  }));

  router.post('/onboarding/complete', verifyCsrf, asyncRoute(async (req, res) => {
    await db.none('UPDATE users SET onboarding_completed = TRUE WHERE user_id = $1',
      [req.session.user.user_id]);
    return res.redirect(303, '/recipes');
  }));

  router.post('/profile/details', auth, verifyCsrf, asyncRoute(async (req, res) => {
    let profile;
    try { profile = parseProfileDetails(req.body); }
    catch (error) { return res.status(400).send(error.message); }
    await db.none(`UPDATE users SET display_name = $1, bio = $2, avatar_url = $3
      WHERE user_id = $4`, [profile.displayName, profile.bio, profile.avatarUrl, req.session.user.user_id]);
    return res.redirect(303, '/settings/profile?updated=1');
  }));
  return router;
}
module.exports = { createOnboardingRouter };
