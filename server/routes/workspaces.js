const express  = require('express');
const crypto   = require('crypto');
const db       = require('../db');
const { requireAuth } = require('../auth');
const { sendMail }    = require('../email');
const rewards         = require('../rewards');

const router = express.Router();
router.use(requireAuth);

function isMember(workspaceId, userId) {
  return db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId);
}
function isOwner(workspaceId, userId) {
  const m = isMember(workspaceId, userId);
  return m && m.role === 'owner';
}

// ── Workspace CRUD ────────────────────────────────────────────────────────────

// GET /api/workspaces
router.get('/', (req, res) => {
  const workspaces = db.prepare(`
    SELECT w.*, wm.role,
           (SELECT COUNT(*) FROM workspace_members wm2 WHERE wm2.workspace_id = w.id) as member_count,
           (SELECT COUNT(*) FROM projects p WHERE p.workspace_id = w.id) as project_count
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?
    ORDER BY wm.joined_at ASC
  `).all(req.user.id);
  res.json(workspaces);
});

// POST /api/workspaces
router.post('/', (req, res) => {
  const { name, description, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const ws = db.prepare(
    `INSERT INTO workspaces (name, description, color, created_by) VALUES (?, ?, ?, ?)`
  ).run(name.trim(), description || '', color || '#6366f1', req.user.id);
  db.prepare(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')`)
    .run(ws.lastInsertRowid, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM workspaces WHERE id = ?').get(ws.lastInsertRowid));
});

// PUT /api/workspaces/:id
router.put('/:id', (req, res) => {
  if (!isOwner(req.params.id, req.user.id)) return res.status(403).json({ error: 'Owner only' });
  const { name, description, color } = req.body;
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
  db.prepare(`UPDATE workspaces SET name = ?, description = ?, color = ? WHERE id = ?`).run(
    name ?? ws.name, description ?? ws.description, color ?? ws.color, req.params.id
  );
  res.json(db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id));
});

// DELETE /api/workspaces/:id
router.delete('/:id', (req, res) => {
  if (!isOwner(req.params.id, req.user.id)) return res.status(403).json({ error: 'Owner only' });
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ── Members ────────────────────────────────────────────────────────────────────

// GET /api/workspaces/:id/members
router.get('/:id/members', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const members = db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar_url, wm.role, wm.joined_at
    FROM workspace_members wm JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ?
    ORDER BY wm.joined_at ASC
  `).all(req.params.id);
  // Also get pending invites (for owners)
  const invites = isOwner(req.params.id, req.user.id)
    ? db.prepare(`
        SELECT id, email, invited_by, expires_at, accepted_at, created_at
        FROM workspace_invites WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > datetime('now')
        ORDER BY created_at DESC
      `).all(req.params.id)
    : [];
  res.json({ members, invites });
});

// DELETE /api/workspaces/:id/members/:userId
router.delete('/:id/members/:userId', (req, res) => {
  const removing = Number(req.params.userId);
  const isSelf = removing === req.user.id;
  if (!isSelf && !isOwner(req.params.id, req.user.id)) return res.status(403).json({ error: 'Owner only' });
  // Prevent owner from removing themselves if they're the only owner
  const m = isMember(req.params.id, removing);
  if (m?.role === 'owner') {
    const ownerCount = db.prepare("SELECT COUNT(*) as c FROM workspace_members WHERE workspace_id = ? AND role = 'owner'").get(req.params.id).c;
    if (ownerCount <= 1) return res.status(400).json({ error: 'Cannot remove the only owner' });
  }
  db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(req.params.id, removing);
  res.status(204).end();
});

// ── Invites ────────────────────────────────────────────────────────────────────

// POST /api/workspaces/:id/invite
router.post('/:id/invite', async (req, res) => {
  if (!isOwner(req.params.id, req.user.id)) return res.status(403).json({ error: 'Owner only' });
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'Email required' });

  // Check not already a member
  const existing = db.prepare('SELECT u.id FROM users u JOIN workspace_members wm ON wm.user_id = u.id WHERE u.email = ? AND wm.workspace_id = ?').get(email.trim(), req.params.id);
  if (existing) return res.status(400).json({ error: 'Already a member' });

  const token  = crypto.randomBytes(24).toString('hex');
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  db.prepare(`
    INSERT OR REPLACE INTO workspace_invites (workspace_id, email, token, invited_by, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, email.trim(), token, req.user.id, expiry);

  const ws      = db.prepare('SELECT name FROM workspaces WHERE id = ?').get(req.params.id);
  const inviter = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
  const appUrl  = process.env.APP_URL || 'http://localhost:5173';

  try {
    await sendMail({
      to: email.trim(),
      subject: `You're invited to join "${ws.name}" on Planner`,
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
    <table width="100%" style="max-width:480px;">
      <tr><td style="background:#111827;padding:24px 28px;border-radius:14px 14px 0 0;">
        <p style="margin:0 0 4px;color:#6b7280;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Planner</p>
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">You're invited!</h1>
      </td></tr>
      <tr><td style="background:#fff;padding:24px 28px;">
        <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
          <strong>${inviter?.name || 'Someone'}</strong> has invited you to collaborate on the
          <strong>"${ws.name}"</strong> workspace in Planner.
        </p>
        <a href="${appUrl}/invite/${token}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;">
          Accept Invitation →
        </a>
        <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;">Link expires in 7 days.</p>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:14px 28px;border-top:1px solid #e5e7eb;border-radius:0 0 14px 14px;">
        <p style="margin:0;color:#9ca3af;font-size:12px;">Sent by <strong style="color:#6366f1;">Planner</strong></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`,
    });
  } catch (err) {
    console.error('[invite] Email send failed:', err.message);
    // Don't fail — the token is saved, user can share it manually
  }

  res.json({ ok: true, token });
});

// ── Public invite lookup (no auth required) ───────────────────────────────────

// GET /api/invite/:token
router.get('/invite/:token', (req, res) => {
  // Note: this endpoint is registered WITHOUT requireAuth
  const inv = db.prepare(`
    SELECT wi.*, w.name as workspace_name, w.color as workspace_color,
           u.name as inviter_name
    FROM workspace_invites wi
    JOIN workspaces w ON w.id = wi.workspace_id
    JOIN users u ON u.id = wi.invited_by
    WHERE wi.token = ? AND wi.expires_at > datetime('now')
  `).get(req.params.token);
  if (!inv) return res.status(404).json({ error: 'Invalid or expired invite' });
  res.json({
    workspace_name:  inv.workspace_name,
    workspace_color: inv.workspace_color,
    inviter_name:    inv.inviter_name,
    email:           inv.email,
    accepted:        !!inv.accepted_at,
  });
});

// POST /api/invite/:token/accept  (requires auth)
router.post('/invite/:token/accept', (req, res) => {
  const inv = db.prepare(`
    SELECT * FROM workspace_invites WHERE token = ? AND expires_at > datetime('now') AND accepted_at IS NULL
  `).get(req.params.token);
  if (!inv) return res.status(404).json({ error: 'Invalid, expired, or already used invite' });

  // Add to workspace
  db.prepare(`INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')`)
    .run(inv.workspace_id, req.user.id);
  db.prepare(`UPDATE workspace_invites SET accepted_at = datetime('now') WHERE id = ?`).run(inv.id);
  rewards.onWorkspaceJoined(req.user.id);

  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(inv.workspace_id);
  res.json({ ok: true, workspace: ws });
});

module.exports = router;
