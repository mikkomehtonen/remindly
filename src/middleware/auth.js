const session = require('express-session');
const bcrypt = require('bcrypt');

let passwordHash = null;
passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'remindly-dev-secret-change-in-production';
}

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
});

function ensureAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.redirect('/admin/login');
}

function verifyPassword(username, password) {
  if (username !== process.env.ADMIN_USERNAME) return false;
  return bcrypt.compareSync(password, passwordHash);
}

module.exports = { sessionMiddleware, ensureAdmin, verifyPassword };
