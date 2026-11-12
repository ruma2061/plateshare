const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');

let db, site;
const password = 'session-test-password';

before(async () => {
  db = await createDatabase({ baseOnly: true });
  await db.none('INSERT INTO users (username, password_hash) VALUES ($1, $2)',
    ['session_target', await bcrypt.hash(password, 4)]);
  site = await createSite(db);
});

after(async () => {
  await site?.close();
  await db?.engine.close();
});

async function existingSession() {
  const user = await db.one('SELECT user_id FROM users WHERE username = $1', ['session_target']);
  const response = await fetch(`${site.base}/test-login/${user.user_id}`, { method: 'POST' });
  return response.headers.get('set-cookie').split(';')[0];
}

function login(cookie, suppliedPassword = password) {
  return fetch(`${site.base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'session_target', password: suppliedPassword }),
  });
}

test('successful login replaces the session ID and rejects replay of the old cookie', async () => {
  const oldCookie = await existingSession();
  const response = await login(oldCookie);
  assert.equal(response.status, 302);
  const newCookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(newCookie, 'login must issue a new session cookie');
  assert.notEqual(newCookie, oldCookie);

  const oldSession = await fetch(`${site.base}/profile`, {
    redirect: 'manual', headers: { cookie: oldCookie },
  });
  assert.equal(oldSession.headers.get('location'), '/login');
  const newSession = await fetch(`${site.base}/profile`, {
    redirect: 'manual', headers: { cookie: newCookie },
  });
  assert.equal(newSession.headers.get('location'), '/profile/session_target');
});

test('failed login preserves the current authenticated session', async () => {
  const cookie = await existingSession();
  const response = await login(cookie, 'incorrect-password');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Incorrect username or password/);
  const profile = await fetch(`${site.base}/profile`, {
    redirect: 'manual', headers: { cookie },
  });
  assert.equal(profile.headers.get('location'), '/profile/session_target');
});
