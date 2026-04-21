require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const db = require('./db');
const { scheduleWeeklyDigest, scheduleDailyEnhancement, scheduleDailyPlanEmail } = require('./cron');
const { enhanceAllUnenhanced, enhanceAllDates } = require('./enhancer');

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

scheduleWeeklyDigest();
scheduleDailyEnhancement();
scheduleDailyPlanEmail();

app.listen(PORT, () => {
  console.log(`Planner server running on port ${PORT}`);
  // Backfill any tasks missing structure or dates — runs in background, non-blocking
  enhanceAllUnenhanced()
    .then(() => enhanceAllDates())
    .catch(err => console.error('[startup] Backfill error:', err.message));
});
