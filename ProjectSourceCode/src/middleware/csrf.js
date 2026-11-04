const { randomBytes, timingSafeEqual } = require('node:crypto');

function prepareCsrf(req, res, next) {
  if (req.session.user) {
    if (!req.session.recipeCsrfToken) req.session.recipeCsrfToken = randomBytes(32).toString('hex');
    res.locals.csrfToken = req.session.recipeCsrfToken;
  }
  next();
}

function verifyCsrf(req, res, next) {
  const submitted = req.body?._csrf;
  const expected = req.session.recipeCsrfToken;
  if (typeof submitted !== 'string' || typeof expected !== 'string'
    || Buffer.byteLength(submitted) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(submitted), Buffer.from(expected))) {
    return res.status(403).render('pages/recipe-error', { message: 'This form expired. Reload the page and try again.' });
  }
  next();
}

module.exports = { prepareCsrf, verifyCsrf };
