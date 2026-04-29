const express = require('express');
const { requireAuth } = require('../auth');
const { BADGES, getStats, backfill } = require('../rewards');

const router = express.Router();
router.use(requireAuth);

// GET /api/rewards — return stats + earned/locked badges
router.get('/', (req, res) => {
  const stats  = getStats(req.user.id);
  const db     = require('../db');
  const earned = db.prepare('SELECT badge_id, earned_at FROM user_badges WHERE user_id = ? ORDER BY earned_at ASC').all(req.user.id);
  const earnedIds = new Set(earned.map(e => e.badge_id));

  const badges = BADGES.map(b => ({
    ...b,
    earned:    earnedIds.has(b.id),
    earned_at: earned.find(e => e.badge_id === b.id)?.earned_at || null,
  }));

  res.json({ ...stats, badges });
});

// POST /api/rewards/backfill — recalculate all points from scratch
router.post('/backfill', (req, res) => {
  const stats = backfill(req.user.id);
  const db    = require('../db');
  const earned = db.prepare('SELECT badge_id, earned_at FROM user_badges WHERE user_id = ? ORDER BY earned_at ASC').all(req.user.id);
  const earnedIds = new Set(earned.map(e => e.badge_id));
  const badges = BADGES.map(b => ({ ...b, earned: earnedIds.has(b.id), earned_at: earned.find(e => e.badge_id === b.id)?.earned_at || null }));
  res.json({ ...stats, badges });
});

module.exports = router;
