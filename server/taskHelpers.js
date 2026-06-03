const db = require('./db');

function recalcTaskStatus(taskId) {
  const stats = db.prepare(
    'SELECT COUNT(*) as total, SUM(checked) as checked FROM checklist_items WHERE task_id = ?'
  ).get(taskId);
  if (!stats.total) return null;
  const pct = (stats.checked / stats.total) * 100;
  const newStatus = pct === 0 ? 'todo' : pct < 50 ? 'in-progress' : pct < 100 ? 'review' : 'done';
  db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, taskId);
  return newStatus;
}

function recalcProjectProgress(projectId) {
  const stats = db.prepare(`
    SELECT COUNT(*) as total, SUM(ci.checked) as checked
    FROM checklist_items ci
    JOIN tasks t ON t.id = ci.task_id
    WHERE t.project_id = ?
  `).get(projectId);
  const progress = stats.total > 0 ? Math.round((stats.checked / stats.total) * 100) : 0;
  const project = db.prepare('SELECT status FROM projects WHERE id = ?').get(projectId);
  const autoStatus = project?.status === 'on-hold' ? project.status
    : progress === 100 ? 'complete'
    : progress > 0    ? 'active'
    : 'planning';
  db.prepare("UPDATE projects SET progress = ?, status = ?, updated_at = datetime('now') WHERE id = ?").run(progress, autoStatus, projectId);
  return progress;
}

module.exports = { recalcTaskStatus, recalcProjectProgress };
