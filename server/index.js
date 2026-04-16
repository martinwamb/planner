const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4002;

app.use(cors());
app.use(express.json());

// List all projects
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(projects);
});

// Get single project
app.get('/api/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

// Create project
app.post('/api/projects', (req, res) => {
  const { name, description, color, priority, status, deadline, progress, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  const result = db.prepare(`
    INSERT INTO projects (name, description, color, priority, status, deadline, progress, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    description || '',
    color || '#6366f1',
    priority || 'medium',
    status || 'planning',
    deadline || null,
    progress ?? 0,
    notes || ''
  );

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(project);
});

// Update project
app.put('/api/projects/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { name, description, color, priority, status, deadline, progress, notes } = req.body;

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

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Planner server running on port ${PORT}`);
});
