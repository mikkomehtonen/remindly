const VALID_KEYS = new Set(
  (process.env.API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
);

function apiKeyGuard(req, res, next) {
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const key = req.get('x-api-key');
  if (!key || !VALID_KEYS.has(key)) {
    return res.status(401).json({ error: 'Missing or invalid API key' });
  }

  next();
}

module.exports = { apiKeyGuard };
