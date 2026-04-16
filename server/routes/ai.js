const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { chat } = require('../ollama');
const { sendMail } = require('../email');

const router = express.Router();
router.use(requireAuth);

// POST /api/ai/enhance-task
// Takes rough notes and structures them into Context/Purpose/Outcome/Approach + checklist
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

  try {
    const raw = await chat(prompt, { json: true });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try to extract JSON from response
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return res.status(500).json({ error: 'AI returned invalid response' });
      parsed = JSON.parse(match[0]);
    }
    res.json(parsed);
  } catch (err) {
    console.error('AI enhance error:', err);
    res.status(500).json({ error: 'AI unavailable' });
  }
});

// POST /api/ai/suggest-priorities
// Analyses all user projects and returns prioritisation advice
router.post('/suggest-priorities', async (req, res) => {
  const projects = db.prepare(`
    SELECT name, status, priority, progress, deadline, description, updated_at
    FROM projects WHERE user_id = ? AND status != 'complete'
    ORDER BY created_at ASC
  `).all(req.user.id);

  if (!projects.length) return res.json({ summary: 'No active projects to analyse.' });

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

  try {
    const raw = await chat(prompt, { json: true });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return res.status(500).json({ error: 'AI returned invalid response' });
      parsed = JSON.parse(match[0]);
    }
    res.json(parsed);
  } catch (err) {
    console.error('AI priorities error:', err);
    res.status(500).json({ error: 'AI unavailable' });
  }
});

// POST /api/ai/weekly-digest
// Generates and emails a weekly summary to the user
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
  const complete = projects.filter(p => p.status === 'complete');
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
2. What needs attention this week (overdue or neglected items)
3. Top 3 priorities for this week with brief rationale
4. One motivational closing line

Format as clean HTML with inline styles. Use a simple table-based layout. Colors: headers #1a1a1a, accent #6366f1, warning #f43f5e, success #10b981. No external CSS.
Return only the HTML body content (no <html>/<head> tags).`;

  try {
    const html = await chat(prompt);

    const subject = `Your weekly planner digest — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
    await sendMail({ to: user.email, subject, html });

    res.json({
      ok: true,
      stats: { total: projects.length, active: active.length, complete: complete.length, overdue: overdue.length, neglected: neglected.length }
    });
  } catch (err) {
    console.error('Weekly digest error:', err);
    res.status(500).json({ error: 'Failed to generate digest' });
  }
});

module.exports = router;
