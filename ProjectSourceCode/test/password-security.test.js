const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');

let db, site;

before(async () => {
  db = await createDatabase({ baseOnly: true });
  site = await createSite(db);
});

after(async () => {
  await site?.close();
  await db?.engine.close();
});

function submit(path, username, password) {
  return fetch(`${site.base}${path}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
  });
}

for (const [label, password] of [
  ['ASCII', 'a'.repeat(73)],
  ['Unicode', 'é'.repeat(37)],
]) {
  test(`registration rejects ${label} passwords exceeding 72 UTF-8 bytes without creating an account`, async () => {
    const username = `too_long_${label}`;
    const response = await submit('/register', username, password);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /72 bytes/);
    assert.equal(await db.oneOrNone('SELECT user_id FROM users WHERE username = $1', [username]), null);
  });
}

for (const [label, password] of [
  ['ascii', 'a'.repeat(72)],
  ['unicode', 'é'.repeat(36)],
]) {
  test(`a ${label} password at 72 bytes can register and log in, but an appended suffix cannot authenticate`, async () => {
    const username = `boundary_${label}`;
    assert.equal((await submit('/register', username, password)).status, 302);
    const login = await submit('/login', username, password);
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), '/profile');
    const truncated = await submit('/login', username, `${password}different`);
    assert.equal(truncated.status, 400);
    assert.equal(truncated.headers.get('set-cookie'), null);
    assert.match(await truncated.text(), /Incorrect username or password/);
  });
}
