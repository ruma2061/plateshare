module.exports = function auth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
};
