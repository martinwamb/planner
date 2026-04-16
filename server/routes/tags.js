const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/tags
router.get('/', (req, res) => {
  const tags = db.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY name ASC').all(req.user.id);
  res.json(tags);
});

// POST /api/tags
router.post('/', (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const result = db.prepare(
      'INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)'
    ).run(req.user.id, name.trim(), color || '#6366f1');
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(tag);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Tag already exists' });
    throw e;
  }
});

// DELETE /api/tags/:id
router.delete('/:id', (req, res) => {
  const tag = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!tag) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
