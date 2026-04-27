const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

function attachTags(projects) {
  if (!projects.length) return projects;
  const ids = projects.map(p => p.id);
  const rows = db.prepare(`
    SELECT pt.project_id, t.id, t.name, t.color
    FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
    WHERE pt.project_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids);
  const map = {};
  for (const r of rows) {
    if (!map[r.project_id]) map[r.project_id] = [];
    map[r.project_id].push({ id: r.id, name: r.name, color: r.color });
  }
  return projects.map(p => ({ ...p, tags: map[p.id] || [] }));
}

function syncTags(projectId, tagIds) {
  db.prepare('DELETE FROM project_tags WHERE project_id = ?').run(projectId);
  if (!tagIds?.length) return;
  const insert = db.prepare('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)');
  for (const tid of tagIds) insert.run(projectId, tid);
}

// GET /api/projects — own + workspace-shared; filter by ?workspace_id=N
router.get('/', (req, res) => {
  const { workspace_id } = req.query;
  let projects;
  if (workspace_id) {
    const isMember = db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspace_id, req.user.id);
    if (!isMember) return res.json([]);
    projects = db.prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at DESC').all(workspace_id);
  } else {
    projects = db.prepare(`
      SELECT DISTINCT p.* FROM projects p
      WHERE p.user_id = ?
         OR p.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?)
      ORDER BY p.created_at DESC
    `).all(req.user.id, req.user.id);
  }
  res.json(attachTags(projects));
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  const project = db.prepare(`
    SELECT DISTINCT p.* FROM projects p
    WHERE p.id = ? AND (
      p.user_id = ?
      OR p.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?)
    )
  `).get(req.params.id, req.user.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(attachTags([project])[0]);
});

// POST /api/projects
router.post('/', (req, res) => {
  const { name, description, color, priority, status, deadline, progress, notes, tag_ids, workspace_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

  // Default to the user's Personal workspace if none specified
  const wsId = workspace_id || db.prepare(
    "SELECT w.id FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id WHERE wm.user_id = ? AND w.name = 'Personal' LIMIT 1"
  ).get(req.user.id)?.id || null;

  const result = db.prepare(`
    INSERT INTO projects (user_id, name, description, color, priority, status, deadline, progress, notes, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    name.trim(),
    description || '',
    color || '#6366f1',
    priority || 'medium',
    status || 'planning',
    deadline || null,
    progress ?? 0,
    notes || '',
    wsId
  );

  syncTags(result.lastInsertRowid, tag_ids);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(attachTags([project])[0]);
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { name, description, color, priority, status, deadline, progress, notes, tag_ids } = req.body;

  db.prepare(`
    UPDATE projects SET
      name = ?, description = ?, color = ?, priority = ?, status = ?,
      deadline = ?, progress = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name ?? existing.name,
    description ?? existing.description,
    color ?? existing.color,
    priority ?? existing.priority,
    status ?? existing.status,
    deadline !== undefined ? deadline : existing.deadline,
    progress ?? existing.progress,
    notes ?? existing.notes,
    req.params.id
  );

  if (tag_ids !== undefined) syncTags(req.params.id, tag_ids);

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(attachTags([updated])[0]);
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare(
    'DELETE FROM projects WHERE id = ? AND user_id = ?'
  ).run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

module.exports = router;
