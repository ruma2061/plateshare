const express = require('express');
const session = require('express-session');
const handlebars = require('express-handlebars');
const path = require('node:path');
const { createRecipeRouter } = require('../../src/recipes/router');

async function createSite(db) {
  const app = express();
  const views = path.join(__dirname, '../../src/views');
  const hbs = handlebars.create({ extname: 'hbs', layoutsDir: `${views}/layouts`, partialsDir: `${views}/partials` });
  app.engine('hbs', hbs.engine);
  app.set('view engine', 'hbs');
  app.set('views', views);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'test-only-session-secret', resave: false, saveUninitialized: false }));
  // Test-only login sets the same session shape as the production login route.
  app.post('/test-login/:id', async (req, res) => {
    req.session.user = await db.one('SELECT user_id, username FROM users WHERE user_id = $1', [Number(req.params.id)]);
    res.sendStatus(204);
  });
  app.use((req, res, next) => { res.locals.user = req.session.user; next(); });
  app.use('/resources', express.static(path.join(__dirname, '../../src/resources')));
  app.use(createRecipeRouter(db));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server, base,
    async client(userId) {
      let cookie = '';
      if (userId) {
        const response = await fetch(`${base}/test-login/${userId}`, { method: 'POST' });
        cookie = response.headers.get('set-cookie').split(';')[0];
      }
      const request = (url, body) => fetch(`${base}${url}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
        headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }) },
        body: body === undefined ? undefined : new URLSearchParams(body),
      });
      let token;
      if (userId) {
        const html = await (await request('/recipes/1')).text();
        token = html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1];
      }
      return { request, token };
    },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

module.exports = { createSite };
