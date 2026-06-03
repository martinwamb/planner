const db = require('./db');
const { chat } = require('./ollama');
const { log: logActivity } = require('./activityLog');

function parseCodeResponse(raw) {
  const fileMatch  = raw.match(/FILE:\s*(.+?)(?:\n|$)/i);
  const notesMatch = raw.match(/NOTES?:\s*([\s\S]+?)$/i);
  const code = raw
    .replace(/FILE:\s*.+?(?:\n|$)/i, '')
    .replace(/NOTES?:\s*[\s\S]+?$/i, '')
    .trim();
  return {
    code,
    filename: fileMatch?.[1]?.trim() || 'generated.js',
    notes: notesMatch?.[1]?.trim() || '',
  };
}

async function generateAndStoreCodeForTask(taskId) {
  const task = db.prepare(`
    SELECT t.*, p.name as project_name, p.github_repo, p.user_id as owner_user_id
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    WHERE t.id = ?
  `).get(taskId);

  if (!task) throw new Error(`Task ${taskId} not found`);
  if (!task.github_repo) throw new Error(`Task ${taskId} project has no GitHub repo`);
  if (task.status === 'done') return null;
  if (task.title.length <= 5) return null;

  const checklist = db.prepare(
    'SELECT text, checked FROM checklist_items WHERE task_id = ? ORDER BY position'
  ).all(taskId);

  const recentCommits = db.prepare(
    'SELECT message, author FROM github_commits WHERE project_id = ? ORDER BY committed_at DESC LIMIT 10'
  ).all(task.project_id);

  const checklistText = checklist.length
    ? checklist.map(c => `${c.checked ? '✓' : '○'} ${c.text}`).join('\n')
    : '(no checklist items)';

  const commitsText = recentCommits.length
    ? recentCommits.map(c => `- ${c.author}: "${c.message}"`).join('\n')
    : '(no commit history yet)';

  const prompt = `You are an expert software developer working on the "${task.project_name}" project (GitHub: ${task.github_repo}).

TASK TO IMPLEMENT: ${task.title}
${task.problem_statement ? `GOAL: ${task.problem_statement}` : ''}

CHECKLIST (steps needed):
${checklistText}

RECENT COMMITS (for code style context):
${commitsText}

Write COMPLETE, RUNNABLE code to implement this task. Follow the patterns suggested by the commit history.
Keep it focused and practical.

After your code, on new lines write exactly:
FILE: <suggested relative file path e.g. src/components/Login.jsx>
NOTES: <2 sentences explaining what you implemented and how to use it>`;

  const raw = await chat(prompt, { json: false });
  const { code, filename, notes } = parseCodeResponse(raw);

  db.prepare(`
    UPDATE tasks
    SET code_draft = ?,
        code_filename = ?,
        code_notes = ?,
        code_generated_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(code, filename, notes, taskId);

  logActivity(task.owner_user_id, task.project_id,
    `Code draft ready for "${task.title}" in ${task.project_name}.`
  );

  console.log(`[codeGen] Draft stored for task ${taskId} "${task.title}" → ${filename}`);
  return { code, filename, notes };
}

module.exports = { generateAndStoreCodeForTask, parseCodeResponse };
