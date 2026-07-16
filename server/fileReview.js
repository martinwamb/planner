const db = require('./db');
const { chat } = require('./ollama');
const { ghGet, getDecryptedPat } = require('./github');
const { log: logActivity } = require('./activityLog');

const MAX_FILE_BYTES = 12000;

const ALLOWED_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.swift', '.scala',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.cs',
  '.php', '.css', '.scss', '.sass', '.less',
  '.html', '.vue', '.svelte', '.astro',
  '.sql', '.sh', '.bash',
]);

const DENY_SUBSTRINGS = [
  'node_modules/', 'vendor/', 'bower_components/', 'third_party/', 'third-party/',
  '.venv/', 'venv/', 'site-packages/', 'pods/', '__pycache__/',
  'dist/', 'build/', 'out/', '.next/', '.nuxt/', '.output/', 'coverage/',
  'target/', '/bin/', '/obj/', '.git/',
];

const DENY_SUFFIXES = [
  '.min.js', '.min.css', '.map', '.bundle.js',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock',
  'gemfile.lock', 'composer.lock', 'cargo.lock', 'go.sum',
];

function extOf(path) {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i).toLowerCase();
}

function isEligible(entry) {
  if (entry.type !== 'blob') return false;
  const lower = entry.path.toLowerCase();
  if (!ALLOWED_EXT.has(extOf(lower))) return false;
  if (DENY_SUBSTRINGS.some(d => lower.includes(d))) return false;
  if (DENY_SUFFIXES.some(d => lower.endsWith(d))) return false;
  if (!entry.size || entry.size > MAX_FILE_BYTES) return false;
  return true;
}

async function selectFileToReview(project, owner, repo, token) {
  const repoInfo = await ghGet(`/repos/${owner}/${repo}`, token);
  const branch = repoInfo.default_branch || 'main';

  const tree = await ghGet(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token);
  const eligible = (tree.tree || []).filter(isEligible);
  if (!eligible.length) return null;

  const reviewed = db.prepare(
    'SELECT file_path, MAX(reviewed_at) AS last FROM file_reviews WHERE project_id = ? GROUP BY file_path'
  ).all(project.id);
  const lastReviewed = new Map(reviewed.map(r => [r.file_path, r.last]));

  const neverReviewed = eligible
    .filter(e => !lastReviewed.has(e.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (neverReviewed.length) {
    const pick = neverReviewed[0];
    return { path: pick.path, sha: pick.sha };
  }

  eligible.sort((a, b) => (lastReviewed.get(a.path) || '').localeCompare(lastReviewed.get(b.path) || ''));
  const pick = eligible[0];
  return { path: pick.path, sha: pick.sha };
}

function buildPrompt(project, filePath, content) {
  return `You are a senior engineer doing a focused review of ONE file from the "${project.name}" project (${project.github_repo}).

FILE PATH: ${filePath}

FILE CONTENTS:
\`\`\`
${content}
\`\`\`

Suggest exactly ONE small, safe, high-value improvement to THIS file.
Rules:
- Pick the single most worthwhile change only — never a list.
- It must be minimal and localized (a few lines), NOT a rewrite of the file.
- Do not suggest reformatting, style-only renames, or adding dependencies.
- Prefer correctness, a bug fix, error handling, or clarity over cosmetics.
- If the file is already solid, say so plainly instead of inventing work.

Respond in EXACTLY this format:
SUMMARY: <one sentence, max 15 words>
SUGGESTION: <2-6 sentences, may include a short snippet of only the changed lines>`;
}

function parseReviewResponse(raw) {
  const summaryMatch = raw.match(/SUMMARY:\s*(.+?)(?:\n|$)/i);
  const suggestionMatch = raw.match(/SUGGESTION:\s*([\s\S]+?)$/i);
  const suggestion = suggestionMatch?.[1]?.trim() || raw.trim();
  const summary = summaryMatch?.[1]?.trim() || suggestion.split('\n')[0].slice(0, 120);
  return { summary, suggestion };
}

function recordReview(project, selected, status, summary, suggestion) {
  db.prepare(`
    INSERT INTO file_reviews (project_id, user_id, file_path, file_sha, status, summary, suggestion)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(project.id, project.user_id, selected.path, selected.sha, status, summary || '', suggestion || '');
}

async function reviewOneFileForProject(project) {
  const [owner, repo] = (project.github_repo || '').split('/');
  let selected = null;
  try {
    const token = getDecryptedPat(project.user_id);
    selected = await selectFileToReview(project, owner, repo, token);
    if (!selected) {
      console.log(`[fileReview] ${project.github_repo}: no eligible files`);
      return;
    }

    const blob = await ghGet(`/repos/${owner}/${repo}/git/blobs/${selected.sha}`, token);
    const content = Buffer.from(blob.content || '', 'base64').toString('utf8');

    if (!content.trim()) {
      recordReview(project, selected, 'empty', '', '');
      return;
    }
    if (content.includes('\u0000')) {
      recordReview(project, selected, 'binary', '', '');
      return;
    }

    const raw = await chat(buildPrompt(project, selected.path, content), { json: false, numCtx: 8192 });
    const { summary, suggestion } = parseReviewResponse(raw);

    recordReview(project, selected, 'ok', summary, suggestion);
    logActivity(project.user_id, project.id, `Reviewed ${selected.path} in ${project.name}: ${summary}`);
    console.log(`[fileReview] ${project.github_repo} → ${selected.path}`);
  } catch (err) {
    console.error(`[fileReview] ${project.github_repo}:`, err.message);
    if (selected) recordReview(project, selected, 'error', '', err.message);
  } finally {
    db.prepare(`UPDATE projects SET github_last_reviewed_at = datetime('now') WHERE id = ?`).run(project.id);
  }
}

function getTodaysReviews(userId) {
  return db.prepare(`
    SELECT fr.file_path, fr.summary, fr.suggestion, p.name AS project_name, p.github_repo
    FROM file_reviews fr
    JOIN projects p ON p.id = fr.project_id
    WHERE fr.user_id = ? AND fr.status = 'ok' AND date(fr.reviewed_at) = date('now')
    ORDER BY fr.reviewed_at ASC
  `).all(userId);
}

module.exports = { reviewOneFileForProject, selectFileToReview, parseReviewResponse, getTodaysReviews };
