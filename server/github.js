const https = require('https');
const db = require('./db');
const { chat } = require('./ollama');
const { decrypt } = require('./crypto');
const { recalcProjectProgress } = require('./taskHelpers');
const { log: logActivity } = require('./activityLog');

const GH_API = 'api.github.com';
const OLLAMA_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes — don't hog Ollama

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function chatWithTimeout(prompt, opts = {}) {
  return Promise.race([
    chat(prompt, opts),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Ollama busy — using fallback')), OLLAMA_TIMEOUT_MS)
    ),
  ]);
}

function ghGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: GH_API,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Planner-App/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('GitHub PAT invalid or expired'));
        if (res.statusCode === 403) return reject(new Error('GitHub rate limit hit or insufficient scope'));
        if (res.statusCode === 404) return reject(new Error('Repository not found or PAT lacks access'));
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`GitHub returned non-JSON (status ${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function getDecryptedPat(userId) {
  const row = db.prepare('SELECT github_pat_enc FROM users WHERE id = ?').get(userId);
  if (!row?.github_pat_enc) throw new Error('No GitHub PAT configured');
  return decrypt(row.github_pat_enc);
}

async function listUserRepos(userId) {
  const token = getDecryptedPat(userId);
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await ghGet(
      `/user/repos?per_page=100&page=${page}&sort=updated&type=all`,
      token
    );
    if (!Array.isArray(batch) || !batch.length) break;
    repos.push(...batch.map(r => ({
      id: r.id,
      full_name: r.full_name,
      private: r.private,
      updated_at: r.updated_at,
      description: r.description,
    })));
    if (batch.length < 100) break;
  }
  return repos;
}

async function fetchRecentCommits(userId, ownerRepo, since) {
  const token = getDecryptedPat(userId);
  const [owner, repo] = ownerRepo.split('/');
  const sinceParam = since ? `&since=${encodeURIComponent(since)}` : '';
  const commits = await ghGet(
    `/repos/${owner}/${repo}/commits?per_page=100${sinceParam}`,
    token
  );
  if (!Array.isArray(commits)) return [];

  const detailed = [];
  for (const c of commits.slice(0, 50)) {
    try {
      const detail = await ghGet(`/repos/${owner}/${repo}/commits/${c.sha}`, token);
      detailed.push({
        sha:          c.sha,
        message:      c.commit.message.split('\n')[0].trim(),
        author:       c.commit.author?.name || c.author?.login || 'unknown',
        committed_at: c.commit.author?.date,
        files:        (detail.files || []).map(f => f.filename).slice(0, 20),
      });
    } catch {
      detailed.push({
        sha:          c.sha,
        message:      c.commit.message.split('\n')[0].trim(),
        author:       c.commit.author?.name || c.author?.login || 'unknown',
        committed_at: c.commit.author?.date,
        files:        [],
      });
    }
  }
  return detailed;
}

// Build fallback tasks from raw commit messages when Ollama is unavailable
function buildFallbackTasks(commits) {
  const seen = new Set();
  const tasks = [];
  for (const c of commits.slice(0, 20)) {
    const title = c.message.split(/[\n:]/)[0].trim();
    if (title.length > 5 && title.length < 80 && !seen.has(title.toLowerCase())) {
      seen.add(title.toLowerCase());
      tasks.push({ title, status: 'todo' });
    }
    if (tasks.length >= 8) break;
  }
  return tasks;
}

async function matchCommitsToTasks(projectId) {
  const commits = db.prepare(`
    SELECT id, sha, message, author, committed_at, files_json
    FROM github_commits WHERE project_id = ? AND processed = 0
    ORDER BY committed_at ASC
  `).all(projectId);
  if (!commits.length) return;

  const tasks = db.prepare(`
    SELECT t.id, t.title, t.status,
           GROUP_CONCAT(ci.text, ' | ') as checklist_texts
    FROM tasks t
    LEFT JOIN checklist_items ci ON ci.task_id = t.id
    WHERE t.project_id = ? AND t.status != 'done'
    GROUP BY t.id
  `).all(projectId);

  if (!tasks.length) {
    db.prepare('UPDATE github_commits SET processed = 1 WHERE project_id = ? AND processed = 0').run(projectId);
    return;
  }

  const project = db.prepare('SELECT id, name, github_repo, user_id FROM projects WHERE id = ?').get(projectId);

  const commitList = commits.map((c, i) => {
    const files = JSON.parse(c.files_json || '[]').slice(0, 10).join(', ');
    return `Commit ${i + 1}: SHA=${c.sha.slice(0, 7)} | Author: ${c.author} | Message: "${c.message}"${files ? ` | Files: ${files}` : ''}`;
  }).join('\n');

  const taskList = tasks.map(t =>
    `Task ID=${t.id}: "${t.title}" [status: ${t.status}]${t.checklist_texts ? ` | Checklist: ${t.checklist_texts}` : ''}`
  ).join('\n');

  const prompt = `You are a project management assistant. Analyze these GitHub commits and determine if any relate to the listed tasks.

TASKS (non-done):
${taskList}

COMMITS:
${commitList}

Rules:
- Only match when the commit message or filenames clearly relate to a task title or checklist item.
- Status meanings: "in-progress" = work started but not finished; "review" = looks complete (keywords: fix, implement, add, complete, finish, done, close, resolve); "done" = explicitly done AND file changes match the task.
- Only advance status (never go backward).
- If uncertain, do NOT match.

Respond ONLY with valid JSON:
{"matches":[{"commit_sha":"<first 7 chars>","task_id":<number>,"new_status":"<in-progress|review|done>","reason":"<brief reason>"}]}
If no matches: {"matches":[]}`;

  let parsed = { matches: [] };
  try {
    const raw = await chatWithTimeout(prompt, { json: true });
    try { parsed = JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }
  } catch (err) {
    console.error(`[github] Ollama matching skipped for project ${projectId}:`, err.message);
  }

  const STATUS_ORDER = { 'todo': 0, 'in-progress': 1, 'review': 2, 'done': 3 };
  const updateTask = db.prepare(
    `UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`
  );
  const updateCommit = db.prepare(
    `UPDATE github_commits SET ai_summary = ? WHERE project_id = ? AND sha LIKE ?`
  );

  for (const match of (parsed.matches || [])) {
    if (!match.task_id || !match.new_status || !match.commit_sha) continue;
    const task = tasks.find(t => t.id === match.task_id);
    if (!task) continue;
    if ((STATUS_ORDER[match.new_status] ?? -1) <= (STATUS_ORDER[task.status] ?? 0)) continue;
    updateTask.run(match.new_status, match.task_id, projectId);
    updateCommit.run(match.reason || '', projectId, `${match.commit_sha}%`);
    const authorCommit = commits.find(c => c.sha.startsWith(match.commit_sha));
    const author = authorCommit?.author || 'Someone';
    const statusLabel = match.new_status === 'done' ? 'completed' : match.new_status === 'review' ? 'ready for review' : 'in progress';
    logActivity(project.user_id, projectId,
      `${author} pushed code to ${project.github_repo}. "${task.title}" is now ${statusLabel}.`
    );
    console.log(`[github] Task ${match.task_id} "${task.title}" → ${match.new_status} (${match.commit_sha})`);
  }

  db.prepare('UPDATE github_commits SET processed = 1 WHERE project_id = ? AND processed = 0').run(projectId);
  recalcProjectProgress(projectId);
}

async function syncProject(project, userId) {
  if (!project.github_repo) return;
  console.log(`[github] Syncing ${project.github_repo} → project ${project.id}`);
  try {
    const commits = await fetchRecentCommits(userId, project.github_repo, project.github_last_synced_at);
    if (commits.length) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO github_commits (project_id, sha, message, author, committed_at, files_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const c of commits) {
        insert.run(project.id, c.sha, c.message, c.author, c.committed_at, JSON.stringify(c.files));
      }
      console.log(`[github] Stored ${commits.length} new commits for project ${project.id}`);
      logActivity(userId, project.id,
        `Checked ${project.github_repo} — ${commits.length} new commit${commits.length !== 1 ? 's' : ''} found.`
      );
    }
    db.prepare(`UPDATE projects SET github_last_synced_at = datetime('now') WHERE id = ?`).run(project.id);
    await matchCommitsToTasks(project.id);
  } catch (err) {
    console.error(`[github] Sync failed for project ${project.id} (${project.github_repo}):`, err.message);
  }
}

async function bootstrapTasksFromCommits(projectId, userId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project?.github_repo) return;

  const existing = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE project_id = ?').get(projectId);
  if (existing.c > 0) return;

  let commits;
  try {
    commits = await fetchRecentCommits(userId, project.github_repo, null);
  } catch (err) {
    console.error(`[github] Could not fetch commits for bootstrap (project ${projectId}):`, err.message);
    return;
  }
  if (!commits.length) return;

  const commitList = commits.slice(0, 80).map((c, i) =>
    `${i + 1}. [${c.committed_at?.slice(0, 10) || 'unknown'}] ${c.author}: "${c.message}"`
  ).join('\n');

  const prompt = `You are analyzing a GitHub repository's commit history to generate a project task list.

Repository: ${project.github_repo}
Recent commits (newest first):
${commitList}

Based on these commits, generate a list of tasks that represent the work done and work remaining.
Rules:
- Group related commits into meaningful tasks (not one task per commit)
- Mark tasks "done" when commits clearly show completed features
- Mark tasks "in-progress" when recent commits show active but unfinished work
- Mark tasks "todo" when commits mention plans or TODOs not yet implemented
- Generate 5-15 tasks maximum — quality over quantity
- Task titles must be clear and actionable

Respond ONLY with valid JSON:
{"tasks":[{"title":"<task title>","status":"<todo|in-progress|done>"}]}`;

  let parsed = { tasks: [] };
  let usedFallback = false;
  try {
    const raw = await chatWithTimeout(prompt, { json: true });
    try { parsed = JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }
  } catch (err) {
    console.error(`[github] Bootstrap AI failed for project ${projectId} (${err.message}) — using fallback tasks`);
    usedFallback = true;
  }

  // If AI returned nothing or failed, fall back to raw commit messages as tasks
  if (!parsed.tasks?.length) {
    parsed.tasks = buildFallbackTasks(commits);
    usedFallback = true;
  }

  const insert = db.prepare(`
    INSERT INTO tasks (project_id, title, status, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  const validStatuses = new Set(['todo', 'in-progress', 'review', 'done']);
  let inserted = 0;
  (parsed.tasks || []).forEach((t, i) => {
    if (!t.title?.trim()) return;
    insert.run(projectId, t.title.trim(), validStatuses.has(t.status) ? t.status : 'todo', i);
    inserted++;
  });

  if (inserted > 0) {
    const source = usedFallback ? 'recent commits' : 'commit history analysis';
    logActivity(userId, projectId,
      `Set up ${inserted} task${inserted !== 1 ? 's' : ''} for "${project.name}" based on ${source}.`
    );
  }
  console.log(`[github] Bootstrapped ${inserted} tasks for project ${projectId} (${project.github_repo})${usedFallback ? ' [fallback]' : ''}`);
}

async function scanAndImportRepos(userId) {
  const repos = await listUserRepos(userId);
  const userProjects = db.prepare('SELECT * FROM projects WHERE user_id = ?').all(userId);

  const ws = db.prepare(
    "SELECT w.id FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id WHERE wm.user_id = ? AND w.name = 'Personal' LIMIT 1"
  ).get(userId);

  const results = { created: 0, linked: 0, skipped: 0, tasks_created: 0 };
  const normalize = s => s.toLowerCase().replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();

  for (const repo of repos) {
    const repoShortName = normalize(repo.full_name.split('/')[1]);
    const match = userProjects.find(p =>
      normalize(p.name) === repoShortName || p.github_repo === repo.full_name
    );

    let project;
    if (match) {
      if (!match.github_repo) {
        db.prepare(`UPDATE projects SET github_repo = ?, github_last_synced_at = NULL, updated_at = datetime('now') WHERE id = ?`)
          .run(repo.full_name, match.id);
        results.linked++;
        match.github_repo = repo.full_name;
        logActivity(userId, match.id,
          `Linked project "${match.name}" to your GitHub repo ${repo.full_name}.`
        );
      } else {
        results.skipped++;
      }
      project = match;
    } else {
      const prettyName = repo.full_name.split('/')[1]
        .replace(/[-_.]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      const result = db.prepare(`
        INSERT INTO projects (user_id, name, description, color, priority, status, workspace_id, github_repo, created_at, updated_at)
        VALUES (?, ?, ?, '#6366f1', 'medium', 'planning', ?, ?, datetime('now'), datetime('now'))
      `).run(userId, prettyName, repo.description || '', ws?.id || null, repo.full_name);
      project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
      userProjects.push(project);
      results.created++;
      logActivity(userId, project.id,
        `Created project "${prettyName}" from your GitHub repo ${repo.full_name}.`
      );
    }

    const tasksBefore = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE project_id = ?').get(project.id).c;
    await bootstrapTasksFromCommits(project.id, userId);
    const tasksAfter = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE project_id = ?').get(project.id).c;
    results.tasks_created += (tasksAfter - tasksBefore);

    // Breathe between repos — don't hammer Ollama
    await sleep(5000);
  }

  return results;
}

module.exports = {
  listUserRepos, syncProject, fetchRecentCommits,
  matchCommitsToTasks, getDecryptedPat,
  bootstrapTasksFromCommits, scanAndImportRepos,
};
