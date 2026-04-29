const Database = require('better-sqlite3');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.resolve(__dirname, 'data.db');
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    avatar_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#6366f1',
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'planning',
    deadline TEXT,
    progress INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS project_tags (
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'todo',
    position INTEGER DEFAULT 0,
    context TEXT DEFAULT '[]',
    purpose TEXT DEFAULT '[]',
    outcome TEXT DEFAULT '[]',
    approach TEXT DEFAULT '[]',
    raw_notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    checked INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS daily_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, date)
  );
`);

// Migrations — each wrapped in try/catch so re-runs are safe
try { db.exec(`ALTER TABLE projects ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`); } catch (_) {}
try { db.exec(`ALTER TABLE tasks ADD COLUMN start_date TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE tasks ADD COLUMN due_date TEXT`); } catch (_) {}

// Task summary v2 — SMART problem statement + 4-quadrant analysis
try { db.exec(`ALTER TABLE tasks ADD COLUMN problem_statement TEXT DEFAULT ''`); } catch (_) {}
try { db.exec(`ALTER TABLE tasks ADD COLUMN quadrant_quick_win TEXT DEFAULT '[]'`); } catch (_) {}
try { db.exec(`ALTER TABLE tasks ADD COLUMN quadrant_fill_in    TEXT DEFAULT '[]'`); } catch (_) {}
try { db.exec(`ALTER TABLE tasks ADD COLUMN quadrant_big_bet    TEXT DEFAULT '[]'`); } catch (_) {}
try { db.exec(`ALTER TABLE tasks ADD COLUMN quadrant_avoid      TEXT DEFAULT '[]'`); } catch (_) {}

// Workspaces
db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#6366f1',
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS workspace_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    invited_by INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
try { db.exec(`ALTER TABLE projects ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL`); } catch (_) {}

// Rewards tables
db.exec(`
  CREATE TABLE IF NOT EXISTS user_stats (
    user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_points       INTEGER DEFAULT 0,
    current_streak     INTEGER DEFAULT 0,
    longest_streak     INTEGER DEFAULT 0,
    last_active_date   TEXT,
    tasks_completed    INTEGER DEFAULT 0,
    checklist_done     INTEGER DEFAULT 0,
    projects_completed INTEGER DEFAULT 0,
    workspaces_joined  INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS user_badges (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id   TEXT NOT NULL,
    earned_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, badge_id)
  );
  CREATE TABLE IF NOT EXISTS point_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    points     INTEGER NOT NULL,
    ref_id     INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Auto-create a Personal workspace for each user who doesn't have one yet,
// and assign their existing projects to it.
const unhoused = db.prepare(`
  SELECT DISTINCT u.id FROM users u
  WHERE NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.user_id = u.id)
`).all();
for (const u of unhoused) {
  const ws = db.prepare(
    `INSERT INTO workspaces (name, description, color, created_by) VALUES ('Personal', 'My personal workspace', '#6366f1', ?)`
  ).run(u.id);
  db.prepare(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')`).run(ws.lastInsertRowid, u.id);
  db.prepare(`UPDATE projects SET workspace_id = ? WHERE user_id = ? AND workspace_id IS NULL`).run(ws.lastInsertRowid, u.id);
}

module.exports = db;
