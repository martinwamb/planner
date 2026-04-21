// Shared AI task enhancement logic used by:
//   - POST /api/projects/:id/tasks  (auto-enhance on creation)
//   - POST /api/ai/enhance-task     (manual enhance from TaskModal)
//   - cron daily enhancement
const db   = require('./db');
const { chat } = require('./ollama');

function getProjectContext(taskId) {
  const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId);
  if (!task) return {};
  return getProjectContextByProjectId(task.project_id, taskId);
}

function getProjectContextByProjectId(projectId, excludeTaskId) {
  const project  = db.prepare('SELECT deadline FROM projects WHERE id = ?').get(projectId);
  const siblings = db.prepare(
    'SELECT title, due_date FROM tasks WHERE project_id = ? AND id != ? AND due_date IS NOT NULL ORDER BY due_date ASC LIMIT 5'
  ).all(projectId, excludeTaskId ?? 0);
  return {
    today:           new Date().toISOString().split('T')[0],
    projectDeadline: project?.deadline || null,
    siblings,
  };
}

function buildPrompt(title, notes, ctx = {}) {
  const today    = ctx.today || new Date().toISOString().split('T')[0];
  const deadline = ctx.projectDeadline ? `project deadline: ${ctx.projectDeadline}` : 'no project deadline';
  const siblings = ctx.siblings?.length
    ? `other tasks already scheduled: ${ctx.siblings.map(t => `"${t.title}" due ${t.due_date}`).join('; ')}`
    : '';

  return `You are a project management assistant. Structure these task notes and suggest a realistic timeline.

Today: ${today}
Task title: ${title}
Rough notes: ${notes || title}
${deadline}
${siblings}

Respond with ONLY a valid JSON object, no explanation, no markdown:
{
  "context":    ["bullet 1 of 8-10 words", "bullet 2", "bullet 3"],
  "purpose":    ["bullet 1 of 8-10 words", "bullet 2", "bullet 3"],
  "outcome":    ["bullet 1 of 8-10 words", "bullet 2", "bullet 3"],
  "approach":   ["bullet 1 of 8-10 words", "bullet 2", "bullet 3"],
  "checklist":  ["action item 1", "action item 2", "action item 3", "action item 4", "action item 5"],
  "start_date": "YYYY-MM-DD",
  "due_date":   "YYYY-MM-DD"
}

context    = background/situation (why this task exists)
purpose    = why this task matters to the project
outcome    = what success looks like when done
approach   = how to execute, step by step thinking
checklist  = specific, simple, non-technical to-do items
start_date = when to start (today or later)
due_date   = realistic completion date, after start_date${ctx.projectDeadline ? ', on or before project deadline' : ''}`;
}

function validateDates(parsed, today) {
  const start = parsed.start_date && parsed.start_date >= today ? parsed.start_date : null;
  const due   = parsed.due_date   && (!start || parsed.due_date > start) ? parsed.due_date : null;
  return { start, due };
}

// Enhance a single task: structure it AND set dates if not already set.
// Safe to call without await — errors are logged, never thrown.
async function enhanceTask(taskId) {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return;

    console.log(`[enhancer] Starting task ${taskId}: "${task.title}"`);

    const ctx = getProjectContext(taskId);
    const raw = await chat(buildPrompt(task.title, task.raw_notes, ctx), { json: true });

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) { console.warn(`[enhancer] Bad JSON for task ${taskId}`); return; }
      parsed = JSON.parse(m[0]);
    }

    const { start, due } = validateDates(parsed, ctx.today);

    // Update structure; only write dates if the task doesn't have them yet
    db.prepare(`
      UPDATE tasks SET
        context    = ?,
        purpose    = ?,
        outcome    = ?,
        approach   = ?,
        start_date = COALESCE(start_date, ?),
        due_date   = COALESCE(due_date, ?),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      JSON.stringify(parsed.context  || []),
      JSON.stringify(parsed.purpose  || []),
      JSON.stringify(parsed.outcome  || []),
      JSON.stringify(parsed.approach || []),
      start, due,
      taskId
    );

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

    console.log(`[enhancer] Done task ${taskId}: "${task.title}" (${start || '—'} → ${due || '—'})`);
  } catch (err) {
    console.error(`[enhancer] Failed task ${taskId}:`, err.message);
  }
}

// Batch-enhance all tasks that have no structured content yet.
async function enhanceAllUnenhanced() {
  const tasks = db.prepare(`
    SELECT id FROM tasks WHERE (context IS NULL OR context = '[]') ORDER BY id ASC
  `).all();
  console.log(`[enhancer] ${tasks.length} task(s) need structuring`);
  for (const t of tasks) await enhanceTask(t.id);
  console.log('[enhancer] Structuring complete');
}

// Backfill dates for all non-done tasks that still have no due_date.
async function enhanceAllDates() {
  const tasks = db.prepare(`
    SELECT t.id, t.title, t.raw_notes, t.project_id
    FROM tasks t
    WHERE t.due_date IS NULL AND t.status != 'done'
    ORDER BY t.id ASC
  `).all();
  if (!tasks.length) { console.log('[enhancer] All tasks already have dates'); return; }
  console.log(`[enhancer] ${tasks.length} task(s) need date suggestion`);

  for (const t of tasks) {
    try {
      const ctx = getProjectContextByProjectId(t.project_id, t.id);
      const prompt = `Today is ${ctx.today}. Suggest a start and due date for this task.

Task: "${t.title}"
Project deadline: ${ctx.projectDeadline || 'none'}
${ctx.siblings?.length ? `Other scheduled tasks: ${ctx.siblings.map(s => `"${s.title}" due ${s.due_date}`).join('; ')}` : ''}
${t.raw_notes ? `Notes: ${t.raw_notes}` : ''}

Respond ONLY with valid JSON — no other text:
{"start_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD"}

Rules: start_date >= today, due_date > start_date${ctx.projectDeadline ? `, both on or before ${ctx.projectDeadline}` : ''}.`;

      const raw = await chat(prompt, { json: true });
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) continue;
        parsed = JSON.parse(m[0]);
      }

      const { start, due } = validateDates(parsed, ctx.today);
      if (due) {
        db.prepare("UPDATE tasks SET start_date = COALESCE(start_date, ?), due_date = ? WHERE id = ?")
          .run(start, due, t.id);
        console.log(`[enhancer] Dated task ${t.id} "${t.title}": ${start || '—'} → ${due}`);
      }
    } catch (err) {
      console.error(`[enhancer] Date suggestion failed for task ${t.id}:`, err.message);
    }
  }
  console.log('[enhancer] Date backfill complete');
}

module.exports = { enhanceTask, enhanceAllUnenhanced, enhanceAllDates, buildPrompt, getProjectContextByProjectId };
