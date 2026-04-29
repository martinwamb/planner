require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const db = require('./db');
const { scheduleWeeklyDigest, scheduleDailyEnhancement, scheduleDailyPlanEmail } = require('./cron');
const { enhanceAllUnenhanced, enhanceAllDates } = require('./enhancer');
const { backfill: rewardsBackfill } = require('./rewards');

const app = express();
const PORT = process.env.PORT || 4002;

app.use(cors({ origin: process.env.APP_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

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
