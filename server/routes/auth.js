const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign, setTokenCookie, clearTokenCookie, requireAuth } = require('../auth');

const router = express.Router();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

function userPayload(user) {
  return { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url };
}

// Assign orphan projects (no user_id) to the first user who claims them
function claimOrphanProjects(userId) {
  db.prepare(`UPDATE projects SET user_id = ? WHERE user_id IS NULL`).run(userId);
}

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name, avatar_url FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json(user);
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare(
    'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)'
  ).run(email.toLowerCase(), name || email.split('@')[0], hash);

  claimOrphanProjects(result.lastInsertRowid);

  const user = db.prepare('SELECT id, email, name, avatar_url FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = sign(userPayload(user));
  setTokenCookie(res, token);
  res.status(201).json(user);
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  claimOrphanProjects(user.id);

  const token = sign(userPayload(user));
  setTokenCookie(res, token);
  res.json({ id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearTokenCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/google — redirect to Google
router.get('/google', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

// GET /api/auth/google/callback
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  const APP_URL = process.env.APP_URL || 'https://planner.wambugumartin.com';

  if (error || !code) return res.redirect(`${APP_URL}/login?error=google_denied`);

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) return res.redirect(`${APP_URL}/login?error=google_failed`);

    // Get user info
    const infoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const gUser = await infoRes.json();

    // Find or create user
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(gUser.id);
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(gUser.email.toLowerCase());
      if (user) {
        // Link Google to existing email account
        db.prepare('UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?')
          .run(gUser.id, gUser.picture, user.id);
      } else {
        const result = db.prepare(
          'INSERT INTO users (email, name, google_id, avatar_url) VALUES (?, ?, ?, ?)'
        ).run(gUser.email.toLowerCase(), gUser.name, gUser.id, gUser.picture);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
        claimOrphanProjects(user.id);
      }
    }

    user = db.prepare('SELECT id, email, name, avatar_url FROM users WHERE id = ?').get(user.id);
    const token = sign(userPayload(user));
    setTokenCookie(res, token);
    res.redirect(APP_URL);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect(`${APP_URL}/login?error=google_failed`);
  }
});

module.exports = router;
