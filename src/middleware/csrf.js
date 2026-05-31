const crypto = require('crypto');

function csrfProtection(req, res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  req.csrfToken = function () {
    return req.session.csrfToken;
  };

  res.locals.csrfToken = req.session ? req.session.csrfToken : '';

  const ignoreMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (ignoreMethods.includes(req.method)) {
    return next();
  }

  const token = req.body && req.body._csrf;
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).send('Invalid CSRF token');
  }

  next();
}

module.exports = { csrfProtection };
