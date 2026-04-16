const cron = require('node-cron');
const db = require('./db');
const { chat } = require('./ollama');
const { sendMail } = require('./email');

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

module.exports = { scheduleWeeklyDigest };
