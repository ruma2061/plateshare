const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = readFileSync(path.join(__dirname, '../src/resources/js/theme.js'), 'utf8');

function openPage({ saved = null, systemDark = false, storageBlocked = false } = {}) {
  const documentEvents = new Map();
  const windowEvents = new Map();
  const systemEvents = new Map();
  const attributes = new Map();
  const buttonAttributes = new Map();
  const label = { textContent: '' };
  let bodyReady = false;
  const button = {
    hidden: true,
    setAttribute: (name, value) => buttonAttributes.set(name, value),
    querySelector: () => label,
  };
  const system = { matches: systemDark, addEventListener: (event, callback) => systemEvents.set(event, callback) };
  const document = {
    documentElement: { setAttribute: (name, value) => attributes.set(name, value), getAttribute: name => attributes.get(name) },
    querySelectorAll: () => bodyReady ? [button] : [],
    addEventListener: (event, callback) => documentEvents.set(event, callback),
  };
  const window = {
    localStorage: {
      getItem() { if (storageBlocked) throw new Error('Storage blocked'); return saved; },
      setItem(key, value) { if (storageBlocked) throw new Error('Storage blocked'); saved = value; },
    },
    matchMedia: () => system,
    addEventListener: (event, callback) => windowEvents.set(event, callback),
  };
  vm.runInNewContext(source, { window, document });
  return {
    button, label, buttonAttributes,
    theme: () => attributes.get('data-bs-theme'),
    saved: () => saved,
    ready() { bodyReady = true; documentEvents.get('DOMContentLoaded')(); },
    click(onToggle = true) { documentEvents.get('click')({ target: { closest: () => onToggle ? button : null } }); },
    changeSystem(dark) { system.matches = dark; systemEvents.get('change')(); },
    changeStorage(key, newValue) { windowEvents.get('storage')({ key, newValue }); },
  };
}

test('first visit follows the system and applies a theme before the body is ready', () => {
  for (const systemDark of [false, true]) {
    const page = openPage({ systemDark });
    assert.equal(page.theme(), systemDark ? 'dark' : 'light');
    assert.equal(page.button.hidden, true);
    page.ready();
    assert.equal(page.button.hidden, false);
    assert.equal(page.label.textContent, systemDark ? 'Light mode' : 'Dark mode');
  }
});

test('a saved light or dark choice takes priority over the system across visits', () => {
  for (const saved of ['light', 'dark']) {
    assert.equal(openPage({ saved, systemDark: saved === 'light' }).theme(), saved);
  }
  assert.equal(openPage({ saved: 'invalid', systemDark: true }).theme(), 'dark');
});

test('the header switch updates the theme, action label, and persisted preference', () => {
  const page = openPage();
  page.ready();
  page.click(false);
  assert.equal(page.theme(), 'light');
  page.click();
  assert.equal(page.theme(), 'dark');
  assert.equal(page.saved(), 'dark');
  assert.equal(page.buttonAttributes.get('aria-label'), 'Switch to light mode');
  assert.equal(page.label.textContent, 'Light mode');
  assert.equal(openPage({ saved: page.saved() }).theme(), 'dark');
  page.click();
  assert.equal(page.theme(), 'light');
  assert.equal(page.saved(), 'light');
  assert.equal(page.buttonAttributes.get('aria-label'), 'Switch to dark mode');
});

test('system appearance changes apply until the user chooses a mode', () => {
  const page = openPage();
  page.ready();
  page.changeSystem(true);
  assert.equal(page.theme(), 'dark');
  page.click();
  page.changeSystem(false);
  page.changeSystem(true);
  assert.equal(page.theme(), 'light');
});

test('theme changes in another tab are reflected, including returning to system appearance', () => {
  const page = openPage({ saved: 'light', systemDark: true });
  page.ready();
  page.changeStorage('other-key', 'dark');
  assert.equal(page.theme(), 'light');
  page.changeStorage('plateshare-theme', 'dark');
  assert.equal(page.theme(), 'dark');
  page.changeStorage('plateshare-theme', 'light');
  assert.equal(page.theme(), 'light');
  page.changeStorage('plateshare-theme', null);
  assert.equal(page.theme(), 'dark');
  page.changeStorage('plateshare-theme', 'light');
  page.changeStorage(null, null);
  assert.equal(page.theme(), 'dark');
});

test('unavailable browser storage does not prevent theme switching', () => {
  const page = openPage({ systemDark: true, storageBlocked: true });
  page.ready();
  assert.equal(page.theme(), 'dark');
  page.click();
  assert.equal(page.theme(), 'light');
  page.click();
  assert.equal(page.theme(), 'dark');
});
