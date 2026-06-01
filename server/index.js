require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const db = require('./db');
const { scheduleWeeklyDigest, scheduleDailyEnhancement, scheduleDailyPlanEmail } = require('./cron');
const { enhanceAllUnenhanced, enhanceAllDates } = require('./enhancer');
const { backfill: rewardsBackfill } = require('./rewards');

const app = express();
const PORT = process.env.PORT || 4002;

app.use(cors({ origin: process.env.APP_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ─── Public email snooze (signed token, no session) ──────────────────────────
app.get('/api/snooze', (req, res) => {
  const { tid, uid, days, exp, sig } = req.query;
  const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const secret  = process.env.JWT_SECRET || 'planner-dev-secret';

  if (!tid || !uid || !days || !exp || !sig)
    return res.redirect(`${APP_URL}?snoozed=invalid`);
  if (Math.floor(Date.now() / 1000) > Number(exp))
    return res.redirect(`${APP_URL}?snoozed=expired`);

  const expected = crypto.createHmac('sha256', secret)
    .update(`${uid}:${tid}:${days}:${exp}`).digest('hex');
  if (expected !== sig) return res.redirect(`${APP_URL}?snoozed=invalid`);

  const task = db.prepare(
    'SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.user_id = ?'
  ).get(Number(tid), Number(uid));
  if (!task) return res.redirect(`${APP_URL}?snoozed=notfound`);

  const today = new Date().toISOString().split('T')[0];
  const base  = task.due_date && task.due_date >= today ? task.due_date : today;
  const d = new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + Number(days));
  const newDueDate = d.toISOString().split('T')[0];

  db.prepare("UPDATE tasks SET due_date = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newDueDate, Number(tid));
  res.redirect(`${APP_URL}?snoozed=${encodeURIComponent(task.title.slice(0, 50))}`);
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api', require('./routes/tasks'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/workspaces', require('./routes/workspaces'));
app.use('/api/rewards',   require('./routes/rewards'));

scheduleWeeklyDigest();
scheduleDailyEnhancement();
scheduleDailyPlanEmail();

app.listen(PORT, () => {
  console.log(`Planner server running on port ${PORT}`);
  // Backfill tasks and rewards — runs in background, non-blocking
  enhanceAllUnenhanced()
    .then(() => enhanceAllDates())
    .catch(err => console.error('[startup] Task backfill error:', err.message));

  // Backfill rewards for all existing users
  try {
    const users = require('./db').prepare('SELECT id FROM users').all();
    for (const u of users) rewardsBackfill(u.id);
  } catch (err) { console.error('[startup] Rewards backfill error:', err.message); }
});
