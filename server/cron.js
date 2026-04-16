const cron = require('node-cron');
const db = require('./db');
const { chat } = require('./ollama');
const { sendMail } = require('./email');

// ─── Weekly digest ────────────────────────────────────────────────────────────
function scheduleWeeklyDigest() {
  // Every Monday at 8:00 AM (server time)
  cron.schedule('0 8 * * 1', async () => {
    console.log('[cron] Running weekly digest...');
    try {
      const users = db.prepare('SELECT * FROM users').all();
      for (const user of users) {
        const projects = db.prepare(`
          SELECT name, status, priority, progress, deadline, description, updated_at
          FROM projects WHERE user_id = ?
          ORDER BY created_at ASC
        `).all(user.id);

        if (!projects.length) continue;

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

        const html = await chat(prompt);
        const subject = `Your weekly planner digest — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
        await sendMail({ to: user.email, subject, html });
        console.log(`[cron] Digest sent to ${user.email}`);
      }
    } catch (err) {
      console.error('[cron] Weekly digest failed:', err);
    }
  });
  console.log('[cron] Weekly digest scheduled for Mondays at 08:00');
}

// ─── Daily task checklist enhancement ────────────────────────────────────────
// Runs every day at 09:00. For each active task that has fewer than 3 unchecked
// items, AI suggests simple, practical next steps and adds them to the checklist.
function scheduleDailyEnhancement() {
  cron.schedule('0 9 * * *', async () => {
    console.log('[cron] Running daily checklist enhancement...');
    try {
      const today = new Date().toISOString().split('T')[0];

      // Get all active tasks (project not complete, task not done)
      const tasks = db.prepare(`
        SELECT t.id, t.title, t.status, t.raw_notes,
               p.name AS project_name, p.description AS project_desc
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE p.status != 'complete' AND t.status != 'done'
        ORDER BY t.project_id, t.id
      `).all();

      for (const task of tasks) {
        // Count unchecked items for this task
        const { unchecked } = db.prepare(
          'SELECT COUNT(*) AS unchecked FROM checklist_items WHERE task_id = ? AND checked = 0'
        ).get(task.id);

        // Only enhance tasks that need more items (fewer than 3 unchecked)
        if (unchecked >= 3) continue;

        // Get existing item texts to avoid duplicates
        const existing = db.prepare(
          'SELECT text FROM checklist_items WHERE task_id = ?'
        ).all(task.id).map(r => r.text.toLowerCase());

        const prompt = `Today is ${today}. You are a helpful project assistant.

Project: "${task.project_name}"
${task.project_desc ? `Project description: ${task.project_desc}` : ''}
Task: "${task.title}"
${task.raw_notes ? `Task notes: ${task.raw_notes}` : ''}
Current task status: ${task.status}
${existing.length ? `Existing checklist items: ${existing.join(', ')}` : ''}

Suggest exactly 3 simple, practical next-step checklist items for this task.
Rules:
- Each item should be a short, clear action (max 10 words)
- Keep language non-technical and straightforward
- Focus on communication, review, or progress actions
- Do NOT repeat existing items
- No explanations, just the list

Respond with ONLY valid JSON, no markdown:
{"items": ["action one", "action two", "action three"]}`;

        let parsed;
        try {
          const raw = await chat(prompt, { json: true });
          try { parsed = JSON.parse(raw); }
          catch {
            const m = raw.match(/\{[\s\S]*\}/);
            if (!m) { console.warn(`[cron] Bad AI response for task ${task.id}`); continue; }
            parsed = JSON.parse(m[0]);
          }
        } catch (err) {
          console.error(`[cron] AI failed for task ${task.id}:`, err.message);
          continue; // skip this task, try the next
        }

        const newItems = (parsed.items || [])
          .filter(text => typeof text === 'string' && text.trim())
          .filter(text => !existing.includes(text.toLowerCase()))
          .slice(0, 3);

        if (!newItems.length) continue;

        // Insert new checklist items
        const maxPos = db.prepare(
          'SELECT COALESCE(MAX(position), -1) AS m FROM checklist_items WHERE task_id = ?'
        ).get(task.id).m;

        const insert = db.prepare(
          'INSERT INTO checklist_items (task_id, text, checked, position) VALUES (?, ?, 0, ?)'
        );
        newItems.forEach((text, i) => insert.run(task.id, text.trim(), maxPos + 1 + i));

        console.log(`[cron] Added ${newItems.length} item(s) to task "${task.title}" (id ${task.id})`);
      }

      console.log('[cron] Daily checklist enhancement complete.');
    } catch (err) {
      console.error('[cron] Daily enhancement failed:', err);
    }
  });
  console.log('[cron] Daily checklist enhancement scheduled for 09:00');
}

module.exports = { scheduleWeeklyDigest, scheduleDailyEnhancement };
