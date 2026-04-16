const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'planner-dev-secret';
const COOKIE = 'planner_token';
const TTL = 60 * 60 * 24 * 30; // 30 days

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: TTL });
}

function verify(token) {
  return jwt.verify(token, SECRET);
}

function setTokenCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: TTL * 1000,
  });
}

function clearTokenCookie(res) {
  res.clearCookie(COOKIE);
}

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = verify(token);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { sign, verify, setTokenCookie, clearTokenCookie, requireAuth, COOKIE };
