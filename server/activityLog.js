const db = require('./db');

function log(userId, projectId, message) {
  try {
    db.prepare(
      `INSERT INTO activity_log (user_id, project_id, message) VALUES (?, ?, ?)`
    ).run(userId, projectId || null, message);
  } catch (_) {}
}

function getRecent(userId, limit = 100) {
  return db.prepare(`
    SELECT al.id, al.message, al.created_at,
           p.name as project_name, p.color as project_color
    FROM activity_log al
    LEFT JOIN projects p ON p.id = al.project_id
    WHERE al.user_id = ?
    ORDER BY al.created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

module.exports = { log, getRecent };
