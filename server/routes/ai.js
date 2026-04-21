const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { chat } = require('../ollama');
const { sendMail } = require('../email');
const { generateAndCacheDailyPlan, formatDailyEmailHtml } = require('../planHelper');

const router = express.Router();
router.use(requireAuth);

// ─── SSE helper ──────────────────────────────────────────────────────────────
// Opens an SSE stream on `res`, sends `: ping` every 5 s so nginx never hits
// proxy_read_timeout, awaits the Ollama chat, then resolves with the raw text.
// The caller is responsible for writing `data: ...` and calling res.end().
function openSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const timer = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 5000);

  return () => clearInterval(timer); // call to stop pinging
}

function sseJSON(res, stopPing, data) {
  stopPing();
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  res.end();
}

function sseError(res, stopPing, message) {
  stopPing();
  res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
  res.end();
}

// ─── POST /api/ai/enhance-task ───────────────────────────────────────────────
router.post('/enhance-task', async (req, res) => {
  const { notes, title } = req.body;
  if (!notes?.trim()) return res.status(400).json({ error: 'Notes required' });

  const prompt = `You are a project management assistant. Structure the following rough task notes into a clear format.

Task title: ${title || 'Untitled task'}
Rough notes: ${notes}

Respond with ONLY a valid JSON object, no explanation, no markdown. Use this exact structure:
{
  "context": ["bullet 1 of 8-10 words", "bullet 2 of 8-10 words", "bullet 3 of 8-10 words"],
  "purpose": ["bullet 1 of 8-10 words", "bullet 2 of 8-10 words", "bullet 3 of 8-10 words"],
  "outcome": ["bullet 1 of 8-10 words", "bullet 2 of 8-10 words", "bullet 3 of 8-10 words"],
  "approach": ["bullet 1 of 8-10 words", "bullet 2 of 8-10 words", "bullet 3 of 8-10 words"],
  "checklist": ["action item 1", "action item 2", "action item 3", "action item 4", "action item 5"]
}

context = background/situation (why this task exists)
purpose = why this task matters to the project
outcome = what success looks like when done
approach = how to execute, step by step thinking
checklist = specific actionable to-do items`;

  const stopPing = openSSE(res);

  try {
    const raw = await chat(prompt, { json: true });
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return sseError(res, stopPing, 'AI returned invalid response');
      parsed = JSON.parse(match[0]);
    }
    sseJSON(res, stopPing, parsed);
  } catch (err) {
    console.error('AI enhance error:', err);
    sseError(res, stopPing, 'AI unavailable. Make sure Ollama is running.');
  }
});

// ─── POST /api/ai/suggest-priorities ─────────────────────────────────────────
router.post('/suggest-priorities', async (req, res) => {
  const projects = db.prepare(`
    SELECT name, status, priority, progress, deadline, description, updated_at
    FROM projects WHERE user_id = ? AND status != 'complete'
    ORDER BY created_at ASC
  `).all(req.user.id);

  if (!projects.length) {
    // No Ollama needed — respond normally
    return res.json({ summary: 'No active projects to analyse.' });
  }

  const today = new Date().toISOString().split('T')[0];
  const projectList = projects.map((p, i) =>
    `${i + 1}. "${p.name}" — status: ${p.status}, priority: ${p.priority}, progress: ${p.progress}%, deadline: ${p.deadline || 'none'}, last updated: ${p.updated_at?.split('T')[0]}, description: ${p.description || 'none'}`
  ).join('\n');

  const prompt = `Today is ${today}. You are a project management advisor. Analyse these projects and give concise, actionable prioritisation advice.

Projects:
${projectList}

Respond with a JSON object:
{
  "top_priority": ["project name — one sentence reason", ...up to 3 items],
  "at_risk": ["project name — reason (overdue/neglected/behind)", ...],
  "suggestions": ["concrete actionable suggestion 1", "suggestion 2", "suggestion 3"],
  "summary": "2-3 sentence overall assessment"
}

Only valid JSON, no markdown.`;

  const stopPing = openSSE(res);

  try {
    const raw = await chat(prompt, { json: true });
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return sseError(res, stopPing, 'AI returned invalid response');
      parsed = JSON.parse(match[0]);
    }
    sseJSON(res, stopPing, parsed);
  } catch (err) {
    console.error('AI priorities error:', err);
    sseError(res, stopPing, 'AI unavailable. Make sure Ollama is running.');
  }
});

// ─── POST /api/ai/weekly-digest ───────────────────────────────────────────────
router.post('/weekly-digest', async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const projects = db.prepare(`
    SELECT name, status, priority, progress, deadline, description, updated_at
    FROM projects WHERE user_id = ?
    ORDER BY created_at ASC
  `).all(req.user.id);

  if (!projects.length) return res.json({ ok: true, message: 'No projects to digest' });

  const today = new Date().toISOString().split('T')[0];
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const active = projects.filter(p => p.status !== 'complete');
  const overdue = active.filter(p => p.deadline && new Date(p.deadline) < new Date());
  const neglected = active.filter(p => p.updated_at < twoWeeksAgo);

  const projectList = projects.map((p, i) =>
    `${i + 1}. "${p.name}" — status: ${p.status}, priority: ${p.priority}, progress: ${p.progress}%, deadline: ${p.deadline || 'none'}, last updated: ${p.updated_at?.split('T')[0]}`
  ).join('\n');

  const prompt = `Today is ${today}. Generate a weekly project digest for ${user.name || user.email}.

Projects:
${projectList}

Write an HTML email digest. Be direct, practical, and encouraging. Include:
1. A brief overall status (1-2 sentences)
2. What needs attention this week (overdue: ${overdue.length}, neglected: ${neglected.length})
3. Top 3 priorities for this week with brief rationale
4. One motivational closing line

Format as clean HTML with inline styles. Colors: headers #1a1a1a, accent #6366f1, warning #f43f5e, success #10b981.
Return only the HTML body content.`;

  const stopPing = openSSE(res);

  try {
    const html = await chat(prompt);
    const subject = `Your weekly planner digest — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
    await sendMail({ to: user.email, subject, html });
    sseJSON(res, stopPing, {
      ok: true,
      stats: { total: projects.length, active: active.length, overdue: overdue.length, neglected: neglected.length }
    });
  } catch (err) {
    console.error('Weekly digest error:', err);
    sseError(res, stopPing, 'Failed to generate digest');
  }
});

// ─── POST /api/ai/daily-plan ──────────────────────────────────────────────────
router.post('/daily-plan', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date required' });
  const stopPing = openSSE(res);
  try {
    const plan = await generateAndCacheDailyPlan(req.user.id, date);
    sseJSON(res, stopPing, plan);
  } catch (err) {
    console.error('Daily plan error:', err);
    sseError(res, stopPing, 'AI unavailable');
  }
});

// ─── POST /api/ai/daily-digest ───────────────────────────────────────────────
// Sends today's plan email — reuses the same cached plan shown in the calendar
// so the email and the app always show identical tasks.
router.post('/daily-digest', async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const today = new Date().toISOString().split('T')[0];
  const dayLabel = new Date(today + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const stopPing = openSSE(res);
  try {
    const plan = await generateAndCacheDailyPlan(req.user.id, today);
    const html  = formatDailyEmailHtml(plan, dayLabel);
    await sendMail({ to: user.email, subject: `Your plan for ${dayLabel}`, html });
    sseJSON(res, stopPing, { ok: true, sent_to: user.email });
  } catch (err) {
    console.error('Daily digest error:', err);
    sseError(res, stopPing, 'Failed to send daily digest');
  }
});

// ─── POST /api/ai/suggest-timeline ───────────────────────────────────────────
// Given a task title + notes + project context, suggests start_date and due_date.
router.post('/suggest-timeline', async (req, res) => {
  const { taskTitle, taskNotes, projectId } = req.body;
  if (!taskTitle?.trim()) return res.status(400).json({ error: 'taskTitle required' });

  const today = new Date().toISOString().split('T')[0];

  let projectContext = '';
  if (projectId) {
    const project = db.prepare('SELECT name, deadline FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
    if (project) {
      const otherTasks = db.prepare(
        'SELECT title, due_date, status FROM tasks WHERE project_id = ? AND due_date IS NOT NULL ORDER BY due_date ASC'
      ).all(projectId);
      projectContext = `Project: "${project.name}" (deadline: ${project.deadline || 'none'})\n`;
      if (otherTasks.length) {
        projectContext += `Other tasks with dates:\n${otherTasks.map(t => `  "${t.title}" — due: ${t.due_date} [${t.status}]`).join('\n')}\n`;
      }
    }
  }

  const prompt = `Today is ${today}. Suggest a realistic timeline for this task.

${projectContext}Task: "${taskTitle}"
${taskNotes ? `Notes: ${taskNotes}` : ''}

Respond ONLY with valid JSON:
{
  "start_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "reason": "one sentence explaining the suggested dates"
}

Rules: start_date must be today or later. due_date must be after start_date. If a project deadline exists, due_date must be on or before it. Be realistic — a small task might need 1-3 days, a complex one 1-2 weeks.`;

  const stopPing = openSSE(res);
  try {
    const raw = await chat(prompt, { json: true });
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return sseError(res, stopPing, 'AI returned invalid response');
      parsed = JSON.parse(match[0]);
    }
    sseJSON(res, stopPing, parsed);
  } catch (err) {
    console.error('Suggest timeline error:', err);
    sseError(res, stopPing, 'AI unavailable');
  }
});

// ─── POST /api/ai/week-plan ───────────────────────────────────────────────────
// Returns a 5-working-day plan starting from the given date.
router.post('/week-plan', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date required' });

  const projects = db.prepare(`
    SELECT id, name, color, priority, deadline, status
    FROM projects WHERE user_id = ? AND status != 'complete'
    ORDER BY priority DESC, deadline ASC NULLS LAST
  `).all(req.user.id);

  if (!projects.length) return res.json({ summary: 'No active projects.', days: [] });

  const projectsWithTasks = projects.map(p => {
    const tasks = db.prepare(`
      SELECT t.id, t.title, t.status
      FROM tasks t WHERE t.project_id = ? AND t.status != 'done'
    `).all(p.id);
    return { ...p, tasks };
  }).filter(p => p.tasks.length > 0);

  if (!projectsWithTasks.length) {
    return res.json({ summary: 'All tasks are complete. Great work!', days: [] });
  }

  // Build next 5 working days from the start date
  const start = new Date(date + 'T12:00:00');
  const workDays = [];
  let d = new Date(start);
  while (workDays.length < 5) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      workDays.push({
        date:  d.toISOString().split('T')[0],
        label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      });
    }
    d.setDate(d.getDate() + 1);
  }

  const projectList = projectsWithTasks.map(p =>
    `Project: "${p.name}" (priority: ${p.priority}, deadline: ${p.deadline || 'none'}, color: ${p.color})\n` +
    p.tasks.map(t => `  Task: "${t.title}" [${t.status}]`).join('\n')
  ).join('\n\n');

  const dayLabels = workDays.map(d => `${d.label} (${d.date})`).join(', ');

  const prompt = `Today is ${date}. You are a productivity coach planning the work week.

Active projects and tasks:
${projectList}

Plan these 5 working days: ${dayLabels}

Spread work sensibly. Prioritise by deadline urgency, project priority, task status.
Each day should focus on 1-2 projects max.

Respond ONLY with valid JSON, no markdown:
{
  "summary": "one sentence overview of the week's priorities",
  "days": [
    {
      "date": "2026-04-17",
      "label": "Thu 17 Apr",
      "blocks": [
        {
          "project": "exact project name",
          "color": "exact hex color",
          "task": "exact task title",
          "focus": "one sentence on what to do this day"
        }
      ]
    }
  ]
}

Include exactly 5 days. Use 1-2 blocks per day maximum.`;

  const stopPing = openSSE(res);

  try {
    const raw = await chat(prompt, { json: true });
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return sseError(res, stopPing, 'AI returned invalid response');
      parsed = JSON.parse(match[0]);
    }
    sseJSON(res, stopPing, parsed);
  } catch (err) {
    console.error('Week plan error:', err);
    sseError(res, stopPing, 'AI unavailable');
  }
});

module.exports = router;
