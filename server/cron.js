const cron = require('node-cron');
const db = require('./db');
const { chat, isReachable } = require('./ollama');
const { sendMail } = require('./email');
const { enhanceAllUnenhanced, enhanceAllDates } = require('./enhancer');
const { generateAndCacheDailyPlan, formatDailyEmailHtml } = require('./planHelper');

// ─── Weekly digest ────────────────────────────────────────────────────────────
function scheduleWeeklyDigest() {
  // Monday 23:00 UTC — inside Ollama's nightly availability window (22:00-06:00
  // UTC), so the per-user Ollama calls below don't hit a stopped service.
  cron.schedule('0 23 * * 1', async () => {
    console.log('[cron] Running weekly digest...');
    if (!(await isReachable())) {
      console.log('[cron] Weekly digest skipped — Ollama not reachable');
      return;
    }
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
  console.log('[cron] Weekly digest scheduled for Mondays at 23:00 UTC');
}

// ─── Daily task enhancement ───────────────────────────────────────────────────
// Runs every day at 05:00 UTC (08:00 EAT) — well inside Ollama's nightly window,
// instead of right at its 06:00 UTC shutdown instant. Enhances any tasks that
// still lack structure, then tops up checklist items on tasks with fewer than
// 3 unchecked items.
function scheduleDailyEnhancement() {
  cron.schedule('0 8 * * *', async () => {  // 08:00 EAT = 05:00 UTC
    console.log('[cron] Running daily enhancement...');
    if (!(await isReachable())) {
      console.log('[cron] Daily enhancement skipped — Ollama not reachable');
      return;
    }
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
  }, { timezone: 'Africa/Nairobi' });
  console.log('[cron] Daily enhancement scheduled for 08:00 EAT (05:00 UTC)');
}

// ─── Daily plan email ─────────────────────────────────────────────────────────
// Runs every weekday at 07:30. Uses the same cached plan as the calendar view
// so the email always matches what the user sees in the app.
function scheduleDailyPlanEmail() {
  // 07:30 Africa/Nairobi (EAT = UTC+3) — node-cron resolves the timezone
  cron.schedule('30 7 * * 1-5', async () => {
    console.log('[cron] Sending daily plan emails...');
    const users = db.prepare('SELECT * FROM users').all();
    const today = new Date().toLocaleString('en-CA', { timeZone: 'Africa/Nairobi' }).split(',')[0];
    const dayLabel = new Date(today + 'T12:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    for (const user of users) {
      try {
        const plan = await generateAndCacheDailyPlan(user.id, today);
        if (!plan.blocks?.length) continue;
        const html = formatDailyEmailHtml(plan, dayLabel, user.id);
        await sendMail({ to: user.email, subject: `Your plan for ${dayLabel}`, html });
        console.log(`[cron] Daily plan email sent to ${user.email}`);
      } catch (err) {
        console.error(`[cron] Daily plan email failed for ${user.email}:`, err.message);
      }
    }
  }, { timezone: 'Africa/Nairobi' });
  console.log('[cron] Daily plan email scheduled for weekdays at 07:30 EAT');
}

// ─── GitHub sync ──────────────────────────────────────────────────────────────
// Runs every 5 minutes but only processes the 3 least-recently-synced repos.
// This keeps a rolling cadence (all 19 repos cycle in ~32 min) without the
// resource spike of syncing all repos in a single burst every 30 minutes.
function scheduleGitHubSync() {
  const { syncProject } = require('./github');
  cron.schedule('*/5 * * * *', async () => {
    try {
      const batch = db.prepare(`
        SELECT p.*, u.github_pat_enc
        FROM projects p
        JOIN users u ON u.id = p.user_id
        WHERE p.github_repo IS NOT NULL AND u.github_pat_enc IS NOT NULL
        ORDER BY p.github_last_synced_at ASC NULLS FIRST
        LIMIT 3
      `).all();
      if (!batch.length) return;
      console.log(`[cron] GitHub sync: ${batch.map(p => p.github_repo).join(', ')}`);
      for (const p of batch) {
        await syncProject(p, p.user_id);
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (err) {
      console.error('[cron] GitHub sync failed:', err.message);
    }
  });
  console.log('[cron] GitHub sync scheduled: 3 repos every 5 minutes (rolling)');
}

// ─── Auto code generation ─────────────────────────────────────────────────────
function scheduleCodeGeneration() {
  const { generateAndStoreCodeForTask } = require('./codeGen');

  cron.schedule('0 2 * * *', async () => {
    console.log('[cron] Running background code generation...');
    if (!(await isReachable())) {
      console.log('[cron] Code generation skipped — Ollama not reachable');
      return;
    }
    try {
      // Eligible: github-linked project, not done, no draft yet, meaningful title
      const tasks = db.prepare(`
        SELECT t.id, t.title FROM tasks t
        JOIN projects p ON p.id = t.project_id
        JOIN users u ON u.id = p.user_id
        WHERE p.github_repo IS NOT NULL
          AND t.status != 'done'
          AND t.code_generated_at IS NULL
          AND length(t.title) > 5
        LIMIT 15
      `).all();

      console.log(`[cron] Code gen: ${tasks.length} task(s) to process`);
      for (const task of tasks) {
        try {
          await generateAndStoreCodeForTask(task.id);
        } catch (err) {
          console.error(`[cron] Code gen failed for task ${task.id} "${task.title}":`, err.message);
        }
        // 8-second pause — code prompts are long; give Ollama breathing room
        await new Promise(r => setTimeout(r, 8000));
      }
      console.log('[cron] Background code generation complete');
    } catch (err) {
      console.error('[cron] Code generation cron error:', err.message);
    }
  }, { timezone: 'Africa/Nairobi' });
  console.log('[cron] Background code generation scheduled for 02:00 EAT');
}

// ─── Nightly per-file review ──────────────────────────────────────────────────
// Runs at 01:00 UTC — between code-gen (23:00 UTC) and daily enhancement
// (05:00 UTC). Reviews exactly 1 file per GitHub-linked repo, ordered by
// least-recently-reviewed, so no repo is neglected even if the run doesn't
// reach every repo before Ollama's window closes at 06:00 UTC.
function scheduleFileReview() {
  const { reviewOneFileForProject } = require('./fileReview');

  cron.schedule('0 1 * * *', async () => {
    console.log('[cron] Running nightly file review...');
    if (!(await isReachable())) {
      console.log('[cron] File review skipped — Ollama not reachable');
      return;
    }
    try {
      const projects = db.prepare(`
        SELECT p.*, u.github_pat_enc
        FROM projects p
        JOIN users u ON u.id = p.user_id
        WHERE p.github_repo IS NOT NULL AND u.github_pat_enc IS NOT NULL
        ORDER BY p.github_last_reviewed_at ASC NULLS FIRST
      `).all();

      console.log(`[cron] File review: ${projects.length} repo(s)`);
      for (const p of projects) {
        await reviewOneFileForProject(p);
        await new Promise(r => setTimeout(r, 8000));
      }
      console.log('[cron] Nightly file review complete');
    } catch (err) {
      console.error('[cron] File review cron error:', err.message);
    }
  });
  console.log('[cron] Nightly file review scheduled for 01:00 UTC');
}

module.exports = { scheduleWeeklyDigest, scheduleDailyEnhancement, scheduleDailyPlanEmail, scheduleGitHubSync, scheduleCodeGeneration, scheduleFileReview };
