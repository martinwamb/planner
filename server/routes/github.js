const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { encrypt } = require('../crypto');
const { listUserRepos, syncProject, scanAndImportRepos } = require('../github');
const { getRecent: getRecentActivity } = require('../activityLog');

const router = express.Router();
router.use(requireAuth);

// Returns whether a PAT is stored — never exposes the token itself
router.get('/pat', (req, res) => {
  const row = db.prepare('SELECT github_pat_enc FROM users WHERE id = ?').get(req.user.id);
  res.json({ hasToken: !!row?.github_pat_enc });
});

// Store or replace PAT (encrypted)
router.put('/pat', (req, res) => {
  const { token } = req.body;
  if (!token?.trim()) return res.status(400).json({ error: 'Token required' });
  if (!/^(ghp_|github_pat_|gho_)/.test(token.trim())) {
    return res.status(400).json({ error: 'Invalid GitHub PAT format. Token must start with ghp_, github_pat_, or gho_' });
  }
  try {
    const enc = encrypt(token.trim());
    db.prepare('UPDATE users SET github_pat_enc = ? WHERE id = ?').run(enc, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    if (err.message.includes('ENCRYPTION_KEY')) {
      return res.status(500).json({ error: 'Server is not configured for GitHub integration (missing ENCRYPTION_KEY)' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Remove PAT and unlink all projects
router.delete('/pat', (req, res) => {
  db.prepare('UPDATE users SET github_pat_enc = NULL WHERE id = ?').run(req.user.id);
  db.prepare(`UPDATE projects SET github_repo = NULL, github_last_synced_at = NULL WHERE user_id = ?`).run(req.user.id);
  res.json({ ok: true });
});

// List repos accessible via the PAT
router.get('/repos', async (req, res) => {
  try {
    const repos = await listUserRepos(req.user.id);
    res.json(repos);
  } catch (err) {
    if (err.message.includes('No GitHub PAT')) return res.status(400).json({ error: err.message });
    if (err.message.includes('invalid or expired')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Link or unlink a GitHub repo from a project
router.post('/projects/:id/link', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { repo } = req.body;
  if (repo && !/^[\w.\-]+\/[\w.\-]+$/.test(repo)) {
    return res.status(400).json({ error: 'Repo must be in owner/name format' });
  }
  db.prepare(`UPDATE projects SET github_repo = ?, github_last_synced_at = NULL, updated_at = datetime('now') WHERE id = ?`)
    .run(repo || null, req.params.id);
  res.json({ ok: true, github_repo: repo || null });
});

// Manual sync trigger for a single project
router.post('/projects/:id/sync', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.github_repo) return res.status(400).json({ error: 'No GitHub repo linked to this project' });

  const pat = db.prepare('SELECT github_pat_enc FROM users WHERE id = ?').get(req.user.id);
  if (!pat?.github_pat_enc) return res.status(400).json({ error: 'No GitHub PAT configured' });

  try {
    await syncProject(project, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch stored commits for display in the UI
router.get('/projects/:id/commits', (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const commits = db.prepare(`
    SELECT sha, message, author, committed_at, ai_summary, processed
    FROM github_commits
    WHERE project_id = ?
    ORDER BY committed_at DESC
    LIMIT 50
  `).all(req.params.id);
  res.json(commits);
});

// POST /api/github/scan-and-import — create a project per repo, bootstrap tasks from commits
router.post('/scan-and-import', async (req, res) => {
  const pat = db.prepare('SELECT github_pat_enc FROM users WHERE id = ?').get(req.user.id);
  if (!pat?.github_pat_enc) return res.status(400).json({ error: 'No GitHub PAT configured. Set it via the GitHub icon in the dashboard.' });
  try {
    const results = await scanAndImportRepos(req.user.id);
    res.json({ ok: true, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/github/unlinked-projects — remove all projects with no github_repo
router.delete('/unlinked-projects', (req, res) => {
  const result = db.prepare(
    `DELETE FROM projects WHERE user_id = ? AND (github_repo IS NULL OR github_repo = '')`
  ).run(req.user.id);
  res.json({ ok: true, deleted: result.changes });
});

// GET /api/github/activity — return recent plain-English activity log
router.get('/activity', (req, res) => {
  const entries = getRecentActivity(req.user.id, 100);
  res.json(entries);
});

module.exports = router;
