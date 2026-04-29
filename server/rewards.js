const db = require('./db');

const BADGES = [
  { id: 'first_win',    emoji: '🚀', name: 'First Win',       desc: 'Complete your first task',              pts: 0   },
  { id: 'task_5',       emoji: '⚡', name: 'Momentum',        desc: 'Complete 5 tasks',                      pts: 0   },
  { id: 'task_10',      emoji: '🔥', name: 'On Fire',         desc: 'Complete 10 tasks',                     pts: 0   },
  { id: 'task_25',      emoji: '💪', name: 'Powerhouse',      desc: 'Complete 25 tasks',                     pts: 0   },
  { id: 'checklist_10', emoji: '✅', name: 'Getting Started', desc: 'Tick off 10 checklist items',           pts: 0   },
  { id: 'checklist_50', emoji: '🎯', name: 'Focused',         desc: 'Tick off 50 checklist items',           pts: 0   },
  { id: 'checklist_100',emoji: '🏅', name: 'Dedicated',       desc: 'Tick off 100 checklist items',          pts: 0   },
  { id: 'streak_3',     emoji: '📅', name: 'Consistent',      desc: '3 days active in a row',                pts: 0   },
  { id: 'streak_7',     emoji: '🌟', name: 'Committed',       desc: '7 days active in a row',                pts: 100 },
  { id: 'proj_1',       emoji: '🏆', name: 'Delivered',       desc: 'Complete your first project',           pts: 0   },
  { id: 'proj_3',       emoji: '👑', name: 'Project Master',  desc: 'Complete 3 projects',                   pts: 0   },
  { id: 'team_player',  emoji: '👥', name: 'Team Player',     desc: 'Join a shared workspace',               pts: 0   },
  { id: 'points_500',   emoji: '💰', name: 'High Achiever',   desc: 'Earn 500 points',                       pts: 0   },
  { id: 'points_1000',  emoji: '💎', name: 'Elite',           desc: 'Earn 1,000 points',                     pts: 0   },
];

function ensureStats(userId) {
  db.prepare('INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)').run(userId);
}

function getStats(userId) {
  ensureStats(userId);
  return db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
}

function updateStreak(userId) {
  const today = new Date().toISOString().split('T')[0];
  const stats  = db.prepare('SELECT last_active_date, current_streak, longest_streak FROM user_stats WHERE user_id = ?').get(userId);
  if (!stats || stats.last_active_date === today) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const streak    = stats.last_active_date === yesterday ? (stats.current_streak || 0) + 1 : 1;
  const longest   = Math.max(streak, stats.longest_streak || 0);
  db.prepare('UPDATE user_stats SET current_streak=?, longest_streak=?, last_active_date=? WHERE user_id=?')
    .run(streak, longest, today, userId);
}

function checkAndGrantBadges(userId) {
  const stats  = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
  if (!stats) return [];
  const earned = new Set(db.prepare('SELECT badge_id FROM user_badges WHERE user_id = ?').all(userId).map(r => r.badge_id));
  const newBadges = [];

  for (const badge of BADGES) {
    if (earned.has(badge.id)) continue;
    let ok = false;
    switch (badge.id) {
      case 'first_win':     ok = stats.tasks_completed    >= 1;   break;
      case 'task_5':        ok = stats.tasks_completed    >= 5;   break;
      case 'task_10':       ok = stats.tasks_completed    >= 10;  break;
      case 'task_25':       ok = stats.tasks_completed    >= 25;  break;
      case 'checklist_10':  ok = stats.checklist_done     >= 10;  break;
      case 'checklist_50':  ok = stats.checklist_done     >= 50;  break;
      case 'checklist_100': ok = stats.checklist_done     >= 100; break;
      case 'streak_3':      ok = (stats.current_streak || stats.longest_streak) >= 3; break;
      case 'streak_7':      ok = (stats.current_streak || stats.longest_streak) >= 7; break;
      case 'proj_1':        ok = stats.projects_completed >= 1;   break;
      case 'proj_3':        ok = stats.projects_completed >= 3;   break;
      case 'team_player':   ok = stats.workspaces_joined  >= 1;   break;
      case 'points_500':    ok = stats.total_points       >= 500; break;
      case 'points_1000':   ok = stats.total_points       >= 1000; break;
    }
    if (ok) {
      db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)').run(userId, badge.id);
      newBadges.push(badge);
      // Some badges carry bonus points
      if (badge.pts > 0) {
        db.prepare('INSERT INTO point_events (user_id, event_type, points) VALUES (?, ?, ?)').run(userId, `badge_${badge.id}`, badge.pts);
        db.prepare('UPDATE user_stats SET total_points = total_points + ? WHERE user_id = ?').run(badge.pts, userId);
      }
    }
  }
  return newBadges;
}

// Award points for an event and run badge + streak checks.
function award(userId, eventType, points, refId = null) {
  ensureStats(userId);
  db.prepare('INSERT INTO point_events (user_id, event_type, points, ref_id) VALUES (?, ?, ?, ?)').run(userId, eventType, points, refId);
  db.prepare('UPDATE user_stats SET total_points = total_points + ? WHERE user_id = ?').run(points, userId);
  updateStreak(userId);
  checkAndGrantBadges(userId);
}

function onChecklistDone(userId, itemId) {
  db.prepare('UPDATE user_stats SET checklist_done = checklist_done + 1 WHERE user_id = ?').run(userId);
  award(userId, 'checklist_item', 10, itemId);
}

function onTaskDone(userId, taskId) {
  db.prepare('UPDATE user_stats SET tasks_completed = tasks_completed + 1 WHERE user_id = ?').run(userId);
  award(userId, 'task_done', 50, taskId);
}

function onProjectDone(userId, projectId) {
  db.prepare('UPDATE user_stats SET projects_completed = projects_completed + 1 WHERE user_id = ?').run(userId);
  award(userId, 'project_done', 200, projectId);
}

function onWorkspaceJoined(userId) {
  const stats = getStats(userId);
  if ((stats.workspaces_joined || 0) === 0) {
    db.prepare('UPDATE user_stats SET workspaces_joined = workspaces_joined + 1 WHERE user_id = ?').run(userId);
    checkAndGrantBadges(userId);
  }
}

// Backfill historical progress for a user — safe to call multiple times
// (point_events dedup via ref_id, stats are recalculated from scratch).
function backfill(userId) {
  ensureStats(userId);

  // Recalculate totals directly from DB — avoids double-counting on re-run
  const checklist = db.prepare(`
    SELECT COUNT(*) as c FROM checklist_items ci
    JOIN tasks t ON t.id = ci.task_id
    JOIN projects p ON p.id = t.project_id
    WHERE ci.checked = 1 AND p.user_id = ?
  `).get(userId)?.c || 0;

  const tasksDone = db.prepare(`
    SELECT COUNT(*) as c FROM tasks t
    JOIN projects p ON p.id = t.project_id
    WHERE t.status = 'done' AND p.user_id = ?
  `).get(userId)?.c || 0;

  const projDone = db.prepare(
    "SELECT COUNT(*) as c FROM projects WHERE user_id = ? AND status = 'complete'"
  ).get(userId)?.c || 0;

  const wsJoined = db.prepare(
    "SELECT COUNT(*) as c FROM workspace_members WHERE user_id = ?"
  ).get(userId)?.c || 0;

  const points = checklist * 10 + tasksDone * 50 + projDone * 200;

  db.prepare(`
    UPDATE user_stats SET
      checklist_done     = ?,
      tasks_completed    = ?,
      projects_completed = ?,
      workspaces_joined  = ?,
      total_points       = ?
    WHERE user_id = ?
  `).run(checklist, tasksDone, projDone, wsJoined > 0 ? 1 : 0, points, userId);

  updateStreak(userId);
  checkAndGrantBadges(userId);

  const stats = getStats(userId);
  console.log(`[rewards] Backfilled user ${userId}: ${points} pts, ${tasksDone} tasks, ${checklist} checklist items, ${projDone} projects`);
  return stats;
}

module.exports = { BADGES, award, onChecklistDone, onTaskDone, onProjectDone, onWorkspaceJoined, backfill, getStats, ensureStats };
