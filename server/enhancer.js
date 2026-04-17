// Shared AI task enhancement logic used by:
//   - POST /api/projects/:id/tasks  (auto-enhance on creation)
//   - cron daily enhancement
//   - batch enhance-all script
const db = require('./db');
const { chat } = require('./ollama');

function buildPrompt(title, notes) {
  return `You are a project management assistant. Structure the following rough task notes into a clear format.

Task title: ${title}
Rough notes: ${notes || title}

Respond with ONLY a valid JSON object, no explanation, no markdown. Use this exact structure:
{
  "context": ["bullet 1 of 8-10 words", "bullet 2", "bullet 3"],
  "purpose": ["bullet 1 of 8-10 words", "bullet 2", "bullet 3"],
  "outcome": ["bullet 1 of 8-10 words", "bullet 2", "bullet 3"],
  "approach": ["bullet 1 of 8-10 words", "bullet 2", "bullet 3"],
  "checklist": ["simple action item 1", "action item 2", "action item 3", "action item 4", "action item 5"]
}

context  = background/situation (why this task exists)
purpose  = why this task matters to the project
outcome  = what success looks like when done
approach = how to execute, step by step thinking
checklist = specific, simple, non-technical actionable to-do items`;
}

// Enhance a single task by id. Updates context/purpose/outcome/approach in DB
// and inserts checklist items that don't already exist.
// Safe to call without await — errors are logged, never thrown.
async function enhanceTask(taskId) {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return;

    console.log(`[enhancer] Starting task ${taskId}: "${task.title}"`);

    const raw = await chat(buildPrompt(task.title, task.raw_notes), { json: true });

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) { console.warn(`[enhancer] Bad JSON for task ${taskId}`); return; }
      parsed = JSON.parse(m[0]);
    }

    // Update structured fields
    db.prepare(`
      UPDATE tasks SET
        context  = ?,
        purpose  = ?,
        outcome  = ?,
        approach = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      JSON.stringify(parsed.context  || []),
      JSON.stringify(parsed.purpose  || []),
      JSON.stringify(parsed.outcome  || []),
      JSON.stringify(parsed.approach || []),
      taskId
    );

    // Add checklist items that don't already exist
    if (parsed.checklist?.length) {
      const existing = db.prepare('SELECT text FROM checklist_items WHERE task_id = ?')
        .all(taskId).map(r => r.text.toLowerCase());
      const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM checklist_items WHERE task_id = ?')
        .get(taskId).m;
      const insert = db.prepare('INSERT INTO checklist_items (task_id, text, checked, position) VALUES (?, ?, 0, ?)');
      parsed.checklist
        .filter(t => t?.trim() && !existing.includes(t.toLowerCase()))
        .forEach((text, i) => insert.run(taskId, text.trim(), maxPos + 1 + i));
    }

    console.log(`[enhancer] Done task ${taskId}: "${task.title}"`);
  } catch (err) {
    console.error(`[enhancer] Failed task ${taskId}:`, err.message);
  }
}

// Batch-enhance all tasks that have no structured content yet.
async function enhanceAllUnenhanced() {
  const tasks = db.prepare(`
    SELECT id, title FROM tasks
    WHERE (context IS NULL OR context = '[]')
    ORDER BY id ASC
  `).all();

  console.log(`[enhancer] ${tasks.length} task(s) need enhancement`);
  for (const t of tasks) {
    await enhanceTask(t.id); // sequential — Ollama handles one at a time
  }
  console.log('[enhancer] Batch enhancement complete');
}

module.exports = { enhanceTask, enhanceAllUnenhanced };
