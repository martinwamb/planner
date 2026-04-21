const cron = require('node-cron');
const db = require('./db');
const { chat } = require('./ollama');
const { sendMail } = require('./email');
const { enhanceAllUnenhanced, enhanceAllDates } = require('./enhancer');
const { generateAndCacheDailyPlan, formatDailyEmailHtml } = require('./planHelper');

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

// ─── Daily task enhancement ───────────────────────────────────────────────────
// Runs every day at 09:00. Enhances any tasks that still lack structure,
// then tops up checklist items on tasks with fewer than 3 unchecked items.
function scheduleDailyEnhancement() {
  cron.schedule('0 9 * * *', async () => {
    console.log('[cron] Running daily enhancement...');
    try {
      // 1. Enhance any tasks that were never structured
      await enhanceAllUnenhanced();

      // 2. Backfill dates for structured tasks that still have none
      await enhanceAllDates();

      // 2. Top up checklist items on tasks with < 3 unchecked items
      const today = new Date().toISOString().split('T')[0];
      const tasks = db.prepare(`
        SELECT t.id, t.title, t.status, t.raw_notes,
               p.name AS project_name, p.description AS project_desc
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE p.status != 'complete' AND t.status != 'done'
        ORDER BY t.project_id, t.id
      `).all();

      for (const task of tasks) {
        const { unchecked } = db.prepare(
          'SELECT COUNT(*) AS unchecked FROM checklist_items WHERE task_id = ? AND checked = 0'
        ).get(task.id);
        if (unchecked >= 3) continue;

        const existing = db.prepare('SELECT text FROM checklist_items WHERE task_id = ?')
          .all(task.id).map(r => r.text.toLowerCase());

        const prompt = `Today is ${today}. You are a helpful project assistant.
Project: "${task.project_name}"
Task: "${task.title}"
${task.raw_notes ? `Notes: ${task.raw_notes}` : ''}
Current status: ${task.status}
${existing.length ? `Existing items: ${existing.join(', ')}` : ''}

Suggest exactly 3 simple, practical next-step checklist items.
Rules: short (max 10 words), non-technical, no repeats, no explanations.
Respond ONLY with valid JSON: {"items": ["action one", "action two", "action three"]}`;

        let parsed;
        try {
          const raw = await chat(prompt, { json: true });
          try { parsed = JSON.parse(raw); }
          catch {
            const m = raw.match(/\{[\s\S]*\}/);
            if (!m) continue;
            parsed = JSON.parse(m[0]);
          }
        } catch (err) {
          console.error(`[cron] AI failed for task ${task.id}:`, err.message);
          continue;
        }

        const newItems = (parsed.items || [])
          .filter(t => typeof t === 'string' && t.trim())
          .filter(t => !existing.includes(t.toLowerCase()))
          .slice(0, 3);

        if (!newItems.length) continue;

        const maxPos = db.prepare(
          'SELECT COALESCE(MAX(position), -1) AS m FROM checklist_items WHERE task_id = ?'
        ).get(task.id).m;
        const insert = db.prepare(
          'INSERT INTO checklist_items (task_id, text, checked, position) VALUES (?, ?, 0, ?)'
        );
        newItems.forEach((text, i) => insert.run(task.id, text.trim(), maxPos + 1 + i));
        console.log(`[cron] Topped up ${newItems.length} item(s) on task "${task.title}"`);
      }

      console.log('[cron] Daily enhancement complete.');
    } catch (err) {
      console.error('[cron] Daily enhancement failed:', err);
    }
  });
  console.log('[cron] Daily enhancement scheduled for 09:00');
}

// ─── Daily plan email ─────────────────────────────────────────────────────────
// Runs every weekday at 07:30. Uses the same cached plan as the calendar view
// so the email always matches what the user sees in the app.
function scheduleDailyPlanEmail() {
  cron.schedule('30 7 * * 1-5', async () => {
    console.log('[cron] Sending daily plan emails...');
    const users = db.prepare('SELECT * FROM users').all();
    const today = new Date().toISOString().split('T')[0];
    const dayLabel = new Date(today + 'T12:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    for (const user of users) {
      try {
        const plan = await generateAndCacheDailyPlan(user.id, today);
        if (!plan.blocks?.length) continue;
        const html = formatDailyEmailHtml(plan, dayLabel);
        await sendMail({ to: user.email, subject: `Your plan for ${dayLabel}`, html });
        console.log(`[cron] Daily plan email sent to ${user.email}`);
      } catch (err) {
        console.error(`[cron] Daily plan email failed for ${user.email}:`, err.message);
      }
    }
  });
  console.log('[cron] Daily plan email scheduled for weekdays at 07:30');
}

module.exports = { scheduleWeeklyDigest, scheduleDailyEnhancement, scheduleDailyPlanEmail };
