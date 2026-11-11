
const chai = require('chai');
const chaiHttp = require('chai-http');
const pgp = require('pg-promise')();
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/app');

chai.use(chaiHttp);
const { expect } = chai;

// Make sure tests never use the development database.
if (
  process.env.NODE_ENV !== 'test' ||
  !process.env.POSTGRES_DB?.endsWith('_test')
) {
  throw new Error('Tests must use an isolated test database');
}

const db = pgp({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
});

const app = createApp(db);
after(() => {
  pgp.end();
});

describe('Welcome route', () => {
  it('returns the default welcome message', async () => {
    const res = await chai.request(app).get('/welcome');

    expect(res).to.have.status(200);
    expect(res.body).to.deep.equal({
      status: 'success',
      message: 'Welcome!'
    });
  });
});

describe('POST /register', () => {
  const validUser = 'lab10_valid_user';
  const invalidUser = 'lab10_invalid_user';

  // Remove only records created by these tests.
  async function cleanup() {
    await db.none(
      'DELETE FROM users WHERE username IN ($1, $2)',
      [validUser, invalidUser]
    );
  }

  beforeEach(cleanup);
  afterEach(cleanup);


  it('registers a valid user', async () => {
    const password = 'password123';

    const res = await chai.request(app)
      .post('/register')
      .redirects(0)
      .send({
        username: validUser,
        password
      });

    expect(res).to.have.status(302);
    expect(res).to.have.header('location', '/login');

    const users = await db.any(
      'SELECT username, password_hash FROM users WHERE username = $1',
      [validUser]
    );

    expect(users).to.have.lengthOf(1);
    expect(users[0].username).to.equal(validUser);
    expect(users[0].password_hash).to.not.equal(password);

    const matches = await bcrypt.compare(
      password,
      users[0].password_hash
    );

    expect(matches).to.be.true;
  });

  it('rejects an invalid registration', async () => {
    const res = await chai.request(app)
      .post('/register')
      .send({
        username: invalidUser,
        password: 'short'
      });

    expect(res).to.have.status(400);
    expect(res.text).to.include(
      'Password must be at least 8 characters.'
    );

    const users = await db.any(
      'SELECT username FROM users WHERE username = $1',
      [invalidUser]
    );

    expect(users).to.have.lengthOf(0);
  });
});

describe('POST /follow/:userId — Extra Credit', () => {
  const followerUsername = 'lab10_ec_follower';
  const privateUsername = 'lab10_ec_private';
  const password = 'password123';

  let followerId;
  let privateUserId;

  // Create test users before each test.
  beforeEach(async () => {
    await cleanup();

    const passwordHash = await bcrypt.hash(password, 10);

    const follower = await db.one(
      `INSERT INTO users (username, password_hash, is_private)
       VALUES ($1, $2, FALSE)
       RETURNING user_id`,
      [followerUsername, passwordHash]
    );

    const privateUser = await db.one(
      `INSERT INTO users (username, password_hash, is_private)
       VALUES ($1, $2, TRUE)
       RETURNING user_id`,
      [privateUsername, passwordHash]
    );

    followerId = follower.user_id;
    privateUserId = privateUser.user_id;
  });

  // Remove test data after each test.
  afterEach(cleanup);

  async function cleanup() {
    await db.none(
      `DELETE FROM follow_requests
       WHERE requester_id IN (
         SELECT user_id FROM users WHERE username IN ($1, $2)
       )
       OR recipient_id IN (
         SELECT user_id FROM users WHERE username IN ($1, $2)
       )`,
      [followerUsername, privateUsername]
    );

    await db.none(
      `DELETE FROM follows
       WHERE follower_id IN (
         SELECT user_id FROM users WHERE username IN ($1, $2)
       )
       OR following_id IN (
         SELECT user_id FROM users WHERE username IN ($1, $2)
       )`,
      [followerUsername, privateUsername]
    );

    await db.none(
      `DELETE FROM users
       WHERE username IN ($1, $2)`,
      [followerUsername, privateUsername]
    );
  }

  it('creates a follow request for a private account', async () => {
    const agent = chai.request.agent(app);

    try {
      // Log in as the follower.
      const login = await agent
        .post('/login')
        .redirects(0)
        .send({
          username: followerUsername,
          password
        });

      expect(login).to.have.status(302);

      // Retrieve a CSRF token for the authenticated session.
      const profilePage = await agent.get('/settings/profile');

      expect(profilePage).to.have.status(200);

      const token = profilePage.text.match(
        /name="_csrf" value="([^"]+)"/
      )?.[1];

      expect(token).to.be.a('string');

      // Request to follow the private account.
      const response = await agent
        .post(`/follow/${privateUserId}`)
        .redirects(0)
        .type('form')
        .send({ _csrf: token });

      expect(response).to.have.status(303);

      // Verify that the request was saved in PostgreSQL.
      const requests = await db.any(
        `SELECT requester_id, recipient_id
         FROM follow_requests
         WHERE requester_id = $1 AND recipient_id = $2`,
        [followerId, privateUserId]
      );

      expect(requests).to.have.lengthOf(1);

      // Private accounts should not be followed automatically.
      const follows = await db.any(
        `SELECT 1 FROM follows
         WHERE follower_id = $1 AND following_id = $2`,
        [followerId, privateUserId]
      );

      expect(follows).to.have.lengthOf(0);
    } finally {
      agent.close();
    }
  });

  it('rejects follow requests from unauthenticated users', async () => {
    // Attempt to follow without logging in.
    const response = await chai.request(app)
      .post(`/follow/${privateUserId}`)
      .redirects(0)
      .send({});

    expect(response).to.have.status(302);
    expect(response).to.have.header('location', '/login');

    // Confirm no follow request was created.
    const requests = await db.any(
      `SELECT 1 FROM follow_requests
       WHERE recipient_id = $1`,
      [privateUserId]
    );

    expect(requests).to.have.lengthOf(0);

    // Confirm no follow relationship was created.
    const follows = await db.any(
      `SELECT 1 FROM follows
       WHERE following_id = $1`,
      [privateUserId]
    );

    expect(follows).to.have.lengthOf(0);
  });
});