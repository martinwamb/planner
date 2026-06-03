const https = require('https');
const db = require('./db');
const { chat } = require('./ollama');
const { decrypt } = require('./crypto');
const { recalcProjectProgress } = require('./taskHelpers');

const GH_API = 'api.github.com';

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
- Only advance status (never go backward). If a task is already "in-progress", only move it to "review" or "done".
- If uncertain, do NOT match. Under-matching is better than over-matching.

Respond ONLY with valid JSON:
{"matches":[{"commit_sha":"<first 7 chars>","task_id":<number>,"new_status":"<in-progress|review|done>","reason":"<brief reason>"}]}
If no matches: {"matches":[]}`;

  let parsed = { matches: [] };
  try {
    const raw = await chat(prompt, { json: true });
    try { parsed = JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }
  } catch (err) {
    console.error(`[github] Ollama matching failed for project ${projectId}:`, err.message);
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
    }
    db.prepare(`UPDATE projects SET github_last_synced_at = datetime('now') WHERE id = ?`).run(project.id);
    await matchCommitsToTasks(project.id);
  } catch (err) {
    console.error(`[github] Sync failed for project ${project.id} (${project.github_repo}):`, err.message);
  }
}

module.exports = { listUserRepos, syncProject, fetchRecentCommits, matchCommitsToTasks, getDecryptedPat };
