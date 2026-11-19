const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');

let db, site, image;
before(async () => {
  db = await createDatabase();
  site = await createSite(db);
  image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#226149' } })
    .withMetadata().png().toBuffer();
});
after(async () => { await site?.close(); await db?.engine.close(); });
beforeEach(async () => {
  await db.engine.exec(`TRUNCATE users, recipes RESTART IDENTITY CASCADE;
    INSERT INTO users (username, password_hash, display_name, avatar_url) VALUES
      ('alice', 'hash', 'Alice', 'https://example.com/alice.jpg'),
      ('bob', 'hash', 'Bob', 'https://example.com/bob.jpg');
    INSERT INTO recipes (user_id, title, directions) VALUES (1, 'Test soup', 'Simmer');`);
});

function profileForm(client, { buffer = image, type = 'image/png', ...fields } = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ _csrf: client.token || '', display_name: 'Alice Cook',
    bio: 'Love cooking', avatar_url: '', ...fields })) form.append(name, value);
  if (buffer !== null) form.append('avatar_photo', new Blob([buffer], { type }), 'photo.png');
  return form;
}

test('multipart uploads save a resized, metadata-free photo to only the current profile', async () => {
  const alice = await site.client(1);
  const response = await alice.request('/profile/details', profileForm(alice));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/settings/profile?updated=1');
  const saved = await db.one('SELECT display_name, bio, avatar_url FROM users WHERE user_id = 1');
  assert.equal(saved.display_name, 'Alice Cook');
  assert.equal(saved.bio, 'Love cooking');
  assert.match(saved.avatar_url, /^data:image\/jpeg;base64,/);
  const metadata = await sharp(Buffer.from(saved.avatar_url.split(',')[1], 'base64')).metadata();
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.exif, undefined);
  assert.equal((await db.one('SELECT avatar_url FROM users WHERE user_id = 2')).avatar_url, 'https://example.com/bob.jpg');
  assert.match(await (await alice.request('/profile/alice')).text(), /src="data:image\/jpeg;base64,/);
  const settings = await (await alice.request('/settings/profile?updated=1')).text();
  assert.match(settings, /Your profile has been saved/);
  assert.match(settings, /enctype="multipart\/form-data"/);
  assert.match(settings, /id="avatar_photo"/);
  assert.match(settings, /data-photo-dropzone/);
  assert.match(settings, /id="avatar_url"[^>]*value=""/);
});

test('editing details preserves uploaded photos, and removal and URL replacement work', async () => {
  const alice = await site.client(1);
  await alice.request('/profile/details', profileForm(alice));
  const uploaded = (await db.one('SELECT avatar_url FROM users WHERE user_id = 1')).avatar_url;
  const details = { _csrf: alice.token, display_name: 'Changed Cook', bio: 'Changed bio', avatar_url: '' };
  assert.equal((await alice.request('/profile/details', profileForm(alice, { buffer: null, display_name: 'Changed Cook' }))).status, 303);
  assert.equal((await db.one('SELECT avatar_url FROM users WHERE user_id = 1')).avatar_url, uploaded);
  assert.equal((await alice.request('/profile/details', details)).status, 303);
  assert.equal((await db.one('SELECT avatar_url FROM users WHERE user_id = 1')).avatar_url, uploaded);
  assert.equal((await alice.request('/profile/details', { ...details, remove_photo: '1' })).status, 303);
  assert.equal((await db.one('SELECT avatar_url FROM users WHERE user_id = 1')).avatar_url, null);
  assert.equal((await alice.request('/profile/details', profileForm(alice, { buffer: null, avatar_url: 'https://example.com/new.jpg' }))).status, 303);
  assert.equal((await db.one('SELECT avatar_url FROM users WHERE user_id = 1')).avatar_url, 'https://example.com/new.jpg');
});

test('uploads require authentication and the current session CSRF token', async () => {
  const alice = await site.client(1);
  const bob = await site.client(2);
  const guest = await site.client();
  assert.equal((await guest.request('/profile/details', profileForm(guest))).headers.get('location'), '/login');
  for (const token of ['', bob.token]) {
    assert.equal((await alice.request('/profile/details', profileForm(alice, { _csrf: token }))).status, 403);
  }
  assert.equal((await db.one('SELECT avatar_url FROM users WHERE user_id = 1')).avatar_url, 'https://example.com/alice.jpg');
});

test('invalid, disguised and oversized files show a recoverable error without saving changes', async () => {
  const alice = await site.client(1);
  for (const file of [
    { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), type: 'image/svg+xml' },
    { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), type: 'image/png' },
    { buffer: Buffer.from('not an image'), type: 'image/png' },
    { buffer: Buffer.alloc(5 * 1024 * 1024 + 1), type: 'image/png' },
  ]) {
    const response = await alice.request('/profile/details', profileForm(alice, file));
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /Choose a valid JPG, PNG, or WebP photo up to 5 MB/);
    assert.match(html, /value="Alice Cook"/);
    assert.match(html, /https:\/\/example.com\/alice.jpg/);
    const saved = await db.one('SELECT display_name, avatar_url FROM users WHERE user_id = 1');
    assert.equal(saved.display_name, 'Alice');
    assert.equal(saved.avatar_url, 'https://example.com/alice.jpg');
  }
});

test('JPEG and WebP uploads work; multiple files and invalid details never replace the photo', async () => {
  const alice = await site.client(1);
  for (const format of ['jpeg', 'webp']) {
    const buffer = await sharp(image).toFormat(format).toBuffer();
    assert.equal((await alice.request('/profile/details', profileForm(alice, { buffer, type: `image/${format}` }))).status, 303);
  }
  const saved = (await db.one('SELECT avatar_url FROM users WHERE user_id = 1')).avatar_url;
  const form = profileForm(alice);
  form.append('avatar_photo', new Blob([image], { type: 'image/png' }), 'another.png');
  assert.equal((await alice.request('/profile/details', form)).status, 400);
  assert.equal((await alice.request('/profile/details', profileForm(alice, { display_name: 'A' }))).status, 400);
  assert.equal((await db.one('SELECT avatar_url FROM users WHERE user_id = 1')).avatar_url, saved);
});
