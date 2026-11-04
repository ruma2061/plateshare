// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require('express'); // To build an application server or API
const app = express();
const handlebars = require('express-handlebars'); //to enable express to work with handlebars
const Handlebars = require('handlebars'); // to include the templating engine responsible for compiling templates
const path = require('path');
const pgp = require('pg-promise')(); // To connect to the Postgres DB from the node server
const bodyParser = require('body-parser');
const session = require('express-session'); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require('bcryptjs'); //  To hash passwords
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part C.

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

// create `ExpressHandlebars` instance and configure the layouts and partials dir.
const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: __dirname + '/views/layouts',
  partialsDir: __dirname + '/views/partials',
});

// database configuration
const dbConfig = {
  host: 'db', // the database server
  port: 5432, // the database port
  database: process.env.POSTGRES_DB, // the database name
  user: process.env.POSTGRES_USER, // the user account to connect with
  password: process.env.POSTGRES_PASSWORD, // the password of the user account
};

const db = pgp(dbConfig);

// test your database
db.connect()
  .then(obj => {
    console.log('Database connection successful'); // you can view this message in the docker compose logs
    obj.done(); // success, release the connection;
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.

// initialize session variables
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

// make the logged in user available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

// *****************************************************
// <!-- Section 4 : API Routes -->
// *****************************************************

// TODO - Include your API routes here
app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/profile');
  }
  res.redirect('/login');
});

app.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect('/profile');
  }
  res.render('pages/register');
});

app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/profile');
  }
  res.render('pages/login');
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send('Logout failed');
    }
    res.clearCookie('connect.sid');
    return res.redirect(303,'/login');
  });
});


const auth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
};

/**
 * GET /profile
 * Redirect logged-in users to their own profile.
 */
app.get('/profile', auth, (req, res) => {
  return res.redirect(
    `/profile/${encodeURIComponent(req.session.user.username)}`
  );
});

async function canViewProfileContent(viewerId, profileUser) {
  // Users can always view their own content
  if (Number(viewerId) === Number(profileUser.user_id)) {
    return true;
  }

  // Public profiles are visible
  if (!profileUser.is_private) {
    return true;
  }

  // Private profiles require an established follow
  const result = await db.one(
    `SELECT EXISTS (
       SELECT 1 FROM follows
       WHERE follower_id = $1 AND following_id = $2
     ) AS allowed`,
    [viewerId, profileUser.user_id]
  );

  return result.allowed;
}

app.get('/profile/edit', auth, async (req, res) => {
  try {
    const profileUser = await db.one(
      `SELECT username, is_private
       FROM users
       WHERE user_id = $1`,
      [req.session.user.user_id]
    );

    return res.render('pages/edit-profile', {
      profileUser
    });

  } catch (error) {
    console.error('Error loading profile settings:', error);
    return res.status(500).send('Unable to load settings');
  }
});

app.get('/profile/:username', auth, async (req, res) => {
  const username = req.params.username;
  const currentUserId = req.session.user.user_id;

  try {
    // Get the profile being viewed
    const profileUser = await db.oneOrNone(
      `SELECT user_id, username, is_private
       FROM users
       WHERE username = $1`,
      [username]
    );

    if (!profileUser) {
      return res.status(404).send('User not found');
    }

    const counts = await db.one(
      `SELECT
        (SELECT COUNT(*) FROM follows
          WHERE following_id = $1) AS followers_count,

        (SELECT COUNT(*) FROM follows
          WHERE follower_id = $1) AS following_count`,
      [profileUser.user_id]
    );

    // Check if viewing your own profile
    const isOwnProfile =
      Number(currentUserId) === Number(profileUser.user_id);
    let followRequestBadge = null;

    if (isOwnProfile) {
      const result = await db.one(
        `SELECT COUNT(*)::int AS count
        FROM follow_requests
        WHERE recipient_id = $1`,
        [currentUserId]
      );

      if (result.count > 0) {
        followRequestBadge =
          result.count > 99 ? '99+' : String(result.count);
      }
    }
    let isFollowing = false;
    let requestPending = false;

    if (!isOwnProfile) {
      // Check for an existing follow or outgoing request
      const relationship = await db.one(
        `SELECT
           EXISTS (
             SELECT 1 FROM follows
             WHERE follower_id = $1 AND following_id = $2
           ) AS is_following,
           EXISTS (
             SELECT 1 FROM follow_requests
             WHERE requester_id = $1 AND recipient_id = $2
           ) AS request_pending`,
        [currentUserId, profileUser.user_id]
      );

      isFollowing = relationship.is_following;
      requestPending = relationship.request_pending;
    }
    const canViewContent =
      isOwnProfile || !profileUser.is_private || isFollowing;

    return res.render('pages/profile', {
      profileUser,
      isOwnProfile,
      isFollowing,
      requestPending,
      canViewContent,
      followersCount: counts.followers_count,
      followingCount: counts.following_count,
      followRequestBadge
    });

  } catch (error) {
    console.error('Error loading profile:', error);
    return res.status(500).send('Internal server error');
  }
});

app.get('/profile/:username/followers', auth, async (req, res) => {
  try {
    const profileUser = await db.oneOrNone(
      'SELECT user_id, username, is_private FROM users WHERE username = $1',
      [req.params.username]
    );

    if (!profileUser) {
      return res.status(404).send('User not found');
    }

    const canView = await canViewProfileContent(
      req.session.user.user_id,
      profileUser
    );

    if (!canView) {
      return res.status(403).send('This account is private');
    }

    const users = await db.any(
      `SELECT u.user_id, u.username
       FROM follows f
       JOIN users u ON f.follower_id = u.user_id
       WHERE f.following_id = $1
       ORDER BY u.username`,
      [profileUser.user_id]
    );

    return res.render('pages/follow-list', {
      profileUser,
      users,
      listTitle: 'Followers',
      emptyMessage: 'No followers yet.',
      canRemoveFollowers:
        Number(req.session.user.user_id) === Number(profileUser.user_id)
    });

  } catch (error) {
    console.error('Error loading followers:', error);
    return res.status(500).send('Unable to load followers');
  }
});

app.get('/profile/:username/following', auth, async (req, res) => {
  try {
    const profileUser = await db.oneOrNone(
      'SELECT user_id, username, is_private FROM users WHERE username = $1',
      [req.params.username]
    );

    if (!profileUser) {
      return res.status(404).send('User not found');
    }

    const canView = await canViewProfileContent(
      req.session.user.user_id,
      profileUser
    );

    if (!canView) {
      return res.status(403).send('This account is private');
    }

    const users = await db.any(
      `SELECT u.user_id, u.username
       FROM follows f
       JOIN users u ON f.following_id = u.user_id
       WHERE f.follower_id = $1
       ORDER BY u.username`,
      [profileUser.user_id]
    );

    return res.render('pages/follow-list', {
      profileUser,
      users,
      listTitle: 'Following',
      emptyMessage: 'Not following anyone yet.'
    });

  } catch (error) {
    console.error('Error loading following:', error);
    return res.status(500).send('Unable to load following list');
  }
});

app.get('/discover', auth, async (req, res) => {
  const query = (req.query.q || '').trim();

  try {
    const profiles = await db.any(
      `SELECT user_id, username, is_private
       FROM users
       WHERE user_id <> $1
         AND username ILIKE $2
       ORDER BY username
       LIMIT 20`,
      [req.session.user.user_id, `%${query}%`]
    );

    return res.render('pages/discover', {
      profiles,
      query
    });

  } catch (error) {
    console.error('Error searching users:', error);
    return res.status(500).render('pages/discover', {
      profiles: [],
      query,
      message: 'Unable to search users.',
      error: true
    });
  }
});

app.post('/login', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password;
    const user = await db.oneOrNone(
        'SELECT * FROM users WHERE username = $1',
        [username]        
    );
    if (!user) {
      return res.render('pages/login', {
        message: 'Incorrect username or password.',
        error: true
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
        return res.render('pages/login', {
            message: 'Incorrect username or password.',
            error: true
        });
    }
    req.session.user = { 
      user_id: user.user_id,
      username: user.username };
    req.session.save((err) => {
        if (err) {
            return res.status(500).send('Session error');
        }
        res.redirect('/profile');
    });
  } catch (err) {
    console.error(err)
    res.status(500).render('pages/login', {
      message: 'An error occurred while logging in.',
      error: true
    });
  }
});
app.post('/register', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  // check the input on the server too, the form checks can be skipped
  let error;
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    error = 'Username must be 3-20 characters and only use letters, numbers, or underscores.';
  } else if (password.length < 8) {
    error = 'Password must be at least 8 characters.';
  }

  if (error) {
    return res.status(400).render('pages/register', {
      message: error,
      error: true,
      username
    });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await db.none(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2);',
      [username, hash]
    );
    return res.redirect('/login');
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).render('pages/register', {
        message: 'Username already exists.',
        error: true,
        username
      });
    }

    console.error(error);
    res.status(500).render('pages/register', {
      message: 'Registration failed, try again.',
      error: true,
      username
    });
  }
});

app.post('/follow/:userId', auth, async (req,res) => {
  const followerId = req.session.user.user_id;
  const followingId = Number(req.params.userId);
  // Validate target user ID
  if (!Number.isSafeInteger(followingId) || followingId <= 0) {
    return res.status(400).send('Invalid user ID');
  }

  // Cannot follow yourself
  if (Number(followerId) === followingId) {
    return res.status(400).send('Cannot follow yourself');
  }

  try {
    const result = await db.tx(async (t) => {
      // Find target user and check their privacy setting
      const targetUser = await t.oneOrNone(
        `SELECT user_id, username, is_private
         FROM users
         WHERE user_id = $1
         FOR UPDATE`,
        [followingId]
      );

      if (!targetUser) {
        return null;
      }

      // Check if already following
      const existingFollow = await t.oneOrNone(
        `SELECT 1 FROM follows
         WHERE follower_id = $1 AND following_id = $2`,
        [followerId, followingId]
      );

      if (existingFollow) {
        return targetUser;
      }

      // Check if request already sent
      const existingRequest = await t.oneOrNone(
        `SELECT 1 FROM follow_requests
         WHERE requester_id = $1 AND recipient_id = $2`,
        [followerId, followingId]
      );

      if (existingRequest) {
        return targetUser;
      }

      if (targetUser.is_private) {
        // Private account: send a follow request
        await t.none(
          `INSERT INTO follow_requests
           (requester_id, recipient_id)
           VALUES ($1, $2)`,
          [followerId, followingId]
        );
      } else {
        // Public account: follow immediately
        await t.none(
          `INSERT INTO follows
           (follower_id, following_id)
           VALUES ($1, $2)`,
          [followerId, followingId]
        );
      }

      return targetUser;
    });

    if (!result) {
      return res.status(404).send('User not found');
    }

    return res.redirect(
      303,
      `/profile/${encodeURIComponent(result.username)}`
    );

  } catch (error) {
    console.error('Follow error:', error);
    return res.status(500).send('Unable to follow user');
  }
});

app.get('/follow/requests', auth, async (req, res) => {
  const userId = req.session.user.user_id;

  try {
    const requests = await db.any(
      `SELECT u.user_id, u.username
       FROM follow_requests fr
       JOIN users u ON u.user_id = fr.requester_id
       WHERE fr.recipient_id = $1
       ORDER BY fr.created_at DESC`,
      [userId]
    );

    return res.render('pages/follow-requests', {
      requests
    });

  } catch (error) {
    console.error('Error loading requests:', error);
    return res.status(500).send('Unable to load requests');
  }
});

app.post('/follow/accept/:userId', auth, async (req, res) => {
  const recipientId = req.session.user.user_id;
  const requesterId = Number(req.params.userId);

  if (!Number.isSafeInteger(requesterId) || requesterId <= 0) {
    return res.status(400).send('Invalid user ID');
  }

  try {
    const accepted = await db.tx(async (t) => {
      // Coordinate with privacy changes and follow requests
      await t.one(
        `SELECT user_id FROM users
         WHERE user_id = $1 FOR UPDATE`,
        [recipientId]
      );

      // Only the recipient can accept this request
      const request = await t.oneOrNone(
        `SELECT requester_id
         FROM follow_requests
         WHERE requester_id = $1 AND recipient_id = $2
         FOR UPDATE`,
        [requesterId, recipientId]
      );

      if (!request) return false;

      await t.none(
        `INSERT INTO follows (follower_id, following_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [requesterId, recipientId]
      );

      await t.none(
        `DELETE FROM follow_requests
         WHERE requester_id = $1 AND recipient_id = $2`,
        [requesterId, recipientId]
      );

      return true;
    });

    if (!accepted) {
      return res.status(404).send('Request not found');
    }

    return res.redirect(303, '/follow/requests');

  } catch (error) {
    console.error('Accept request error:', error);
    return res.status(500).send('Unable to accept request');
  }
});

app.post('/follow/decline/:userId', auth, async (req, res) => {
  const recipientId = req.session.user.user_id;
  const requesterId = Number(req.params.userId);

  if (!Number.isSafeInteger(requesterId) || requesterId <= 0) {
    return res.status(400).send('Invalid user ID');
  }

  try {
    await db.none(
      `DELETE FROM follow_requests
       WHERE requester_id = $1 AND recipient_id = $2`,
      [requesterId, recipientId]
    );

    return res.redirect(303, '/follow/requests');

  } catch (error) {
    console.error('Decline request error:', error);
    return res.status(500).send('Unable to decline request');
  }
});


app.post('/follow/cancel/:userId', auth, async (req, res) => {
  const requesterId = req.session.user.user_id;
  const recipientId = Number(req.params.userId);

  if (!Number.isSafeInteger(recipientId) || recipientId <= 0) {
    return res.status(400).send('Invalid user ID');
  }

  try {
    const targetUser = await db.oneOrNone(
      'SELECT username FROM users WHERE user_id = $1',
      [recipientId]
    );

    if (!targetUser) {
      return res.status(404).send('User not found');
    }

    await db.none(
      `DELETE FROM follow_requests
       WHERE requester_id = $1 AND recipient_id = $2`,
      [requesterId, recipientId]
    );

    return res.redirect(
      303,
      `/profile/${encodeURIComponent(targetUser.username)}`
    );

  } catch (error) {
    console.error('Cancel request error:', error);
    return res.status(500).send('Unable to cancel request');
  }
});

app.post('/unfollow/:userId', auth, async (req, res) => {
  const followerId = req.session.user.user_id;
  const followingId = Number(req.params.userId);

  if (!Number.isSafeInteger(followingId) || followingId <= 0) {
    return res.status(400).send('Invalid user ID');
  }

  try {
    const targetUser = await db.oneOrNone(
      'SELECT username FROM users WHERE user_id = $1',
      [followingId]
    );

    if (!targetUser) {
      return res.status(404).send('User not found');
    }

    await db.none(
      `DELETE FROM follows
       WHERE follower_id = $1 AND following_id = $2`,
      [followerId, followingId]
    );

    return res.redirect(
      303,
      `/profile/${encodeURIComponent(targetUser.username)}`
    );

  } catch (error) {
    console.error('Unfollow error:', error);
    return res.status(500).send('Unable to unfollow user');
  }
});

app.post('/followers/remove/:userId', auth, async (req, res) => {
  const currentUserId = req.session.user.user_id;
  const followerId = Number(req.params.userId);

  if (!Number.isSafeInteger(followerId) || followerId <= 0) {
    return res.status(400).send('Invalid user ID');
  }

  try {
    await db.none(
      `DELETE FROM follows
       WHERE follower_id = $1
         AND following_id = $2`,
      [followerId, currentUserId]
    );

    return res.redirect(
      303,
      `/profile/${encodeURIComponent(req.session.user.username)}/followers`
    );

  } catch (error) {
    console.error('Remove follower error:', error);
    return res.status(500).send('Unable to remove follower');
  }
});

app.post('/profile/privacy', auth, async (req, res) => {
  const isPrivate = req.body.is_private;

  if (isPrivate !== 'true' && isPrivate !== 'false') {
    return res.status(400).send('Invalid privacy setting');
  }

  const userId = req.session.user.user_id;
  const makePrivate = isPrivate === 'true';

  try {
    await db.tx(async (t) => {
      // Lock the user's row while changing privacy
      await t.one(
        'SELECT user_id FROM users WHERE user_id = $1 FOR UPDATE',
        [userId]
      );

      await t.none(
        `UPDATE users
         SET is_private = $1
         WHERE user_id = $2`,
        [makePrivate, userId]
      );

      // When switching to public, approve pending requests
      if (!makePrivate) {
        await t.none(
          `INSERT INTO follows (follower_id, following_id)
           SELECT requester_id, recipient_id
           FROM follow_requests
           WHERE recipient_id = $1
           ON CONFLICT DO NOTHING`,
          [userId]
        );

        await t.none(
          `DELETE FROM follow_requests
           WHERE recipient_id = $1`,
          [userId]
        );
      }
    });

    return res.redirect(303, '/profile');

  } catch (error) {
    console.error('Privacy update error:', error);
    return res.status(500).send('Unable to update privacy');
  }
});



// *****************************************************
// <!-- Section 5 : Start Server-->
// *****************************************************
// starting the server and keeping the connection open to listen for more requests
app.listen(3000);
console.log('Server is listening on port 3000');