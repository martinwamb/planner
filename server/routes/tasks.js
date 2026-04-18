const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { enhanceTask } = require('../enhancer');

const router = express.Router();
router.use(requireAuth);

function ownsProject(projectId, userId) {
  return db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
}

// Recalculate task status from checklist completion rate
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

// Recalculate project progress from all checklist items across all tasks
function recalcProjectProgress(projectId) {
  const stats = db.prepare(`
    SELECT COUNT(*) as total, SUM(ci.checked) as checked
    FROM checklist_items ci
    JOIN tasks t ON t.id = ci.task_id
    WHERE t.project_id = ?
  `).get(projectId);
  const progress = stats.total > 0 ? Math.round((stats.checked / stats.total) * 100) : 0;
  db.prepare("UPDATE projects SET progress = ?, updated_at = datetime('now') WHERE id = ?").run(progress, projectId);
  return progress;
}

function attachChecklist(tasks) {
  if (!tasks.length) return tasks;
  const ids = tasks.map(t => t.id);
  const items = db.prepare(`
    SELECT * FROM checklist_items WHERE task_id IN (${ids.map(() => '?').join(',')})
    ORDER BY position ASC, id ASC
  `).all(...ids);
  const map = {};
  for (const item of items) {
    if (!map[item.task_id]) map[item.task_id] = [];
    map[item.task_id].push(item);
  }
  return tasks.map(t => ({
    ...t,
    context: JSON.parse(t.context || '[]'),
    purpose: JSON.parse(t.purpose || '[]'),
    outcome: JSON.parse(t.outcome || '[]'),
    approach: JSON.parse(t.approach || '[]'),
    checklist: map[t.id] || [],
  }));
}

// GET /api/projects/:projectId/tasks
router.get('/projects/:projectId/tasks', (req, res) => {
  if (!ownsProject(req.params.projectId, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const tasks = db.prepare(
    'SELECT * FROM tasks WHERE project_id = ? ORDER BY position ASC, id ASC'
  ).all(req.params.projectId);
  res.json(attachChecklist(tasks));
});

// POST /api/projects/:projectId/tasks
router.post('/projects/:projectId/tasks', (req, res) => {
  if (!ownsProject(req.params.projectId, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const { title, status, context, purpose, outcome, approach, raw_notes, checklist } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });

  const maxPos = db.prepare('SELECT MAX(position) as m FROM tasks WHERE project_id = ?').get(req.params.projectId);

  const result = db.prepare(`
    INSERT INTO tasks (project_id, title, status, position, context, purpose, outcome, approach, raw_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.projectId,
    title.trim(),
    status || 'todo',
    (maxPos?.m ?? -1) + 1,
    JSON.stringify(context || []),
    JSON.stringify(purpose || []),
    JSON.stringify(outcome || []),
    JSON.stringify(approach || []),
    raw_notes || ''
  );

  if (checklist?.length) {
    const insertItem = db.prepare('INSERT INTO checklist_items (task_id, text, position) VALUES (?, ?, ?)');
    checklist.forEach((text, i) => insertItem.run(result.lastInsertRowid, text, i));
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(attachChecklist([task])[0]);

  // Fire-and-forget background enhancement — runs on the server even if the
  // browser closes. Ollama updates context/purpose/outcome/approach + checklist
  // asynchronously; the task will be structured next time the user opens it.
  if (title.trim()) enhanceTask(result.lastInsertRowid);
});

// PUT /api/tasks/:id
router.put('/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.user_id = ?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Not found' });

  const { title, status, position, context, purpose, outcome, approach, raw_notes, checklist } = req.body;

  db.prepare(`
    UPDATE tasks SET
      title = ?, status = ?, position = ?,
      context = ?, purpose = ?, outcome = ?, approach = ?,
      raw_notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title ?? task.title,
    status ?? task.status,
    position ?? task.position,
    JSON.stringify(context ?? JSON.parse(task.context)),
    JSON.stringify(purpose ?? JSON.parse(task.purpose)),
    JSON.stringify(outcome ?? JSON.parse(task.outcome)),
    JSON.stringify(approach ?? JSON.parse(task.approach)),
    raw_notes ?? task.raw_notes,
    req.params.id
  );

  if (checklist !== undefined) {
    db.prepare('DELETE FROM checklist_items WHERE task_id = ?').run(req.params.id);
    if (checklist.length) {
      const insert = db.prepare('INSERT INTO checklist_items (task_id, text, checked, position) VALUES (?, ?, ?, ?)');
      checklist.forEach((item, i) => insert.run(req.params.id, item.text, item.checked ? 1 : 0, i));
    }
    recalcTaskStatus(req.params.id);
  }

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  const project_progress = checklist !== undefined ? recalcProjectProgress(task.project_id) : undefined;
  const payload = attachChecklist([updated])[0];
  if (project_progress !== undefined) payload.project_progress = project_progress;
  res.json(payload);
});

// PATCH /api/tasks/:id/status — quick status update (Kanban drag)
router.patch('/tasks/:id/status', (req, res) => {
  const task = db.prepare('SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.user_id = ?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const { status } = req.body;
  db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

// PATCH /api/checklist/:id — toggle checklist item, auto-update task status + project progress
router.patch('/checklist/:id', (req, res) => {
  const item = db.prepare(`
    SELECT ci.*, t.project_id FROM checklist_items ci
    JOIN tasks t ON t.id = ci.task_id
    JOIN projects p ON p.id = t.project_id
    WHERE ci.id = ? AND p.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { checked } = req.body;
  db.prepare('UPDATE checklist_items SET checked = ? WHERE id = ?').run(checked ? 1 : 0, req.params.id);
  const task_status    = recalcTaskStatus(item.task_id);
  const project_progress = recalcProjectProgress(item.project_id);
  res.json({ ok: true, task_status, project_progress });
});

// DELETE /api/tasks/:id
router.delete('/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.user_id = ?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
