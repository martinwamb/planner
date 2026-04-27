const db = require('./db');
const { chat } = require('./ollama');

const QUOTES = [
  "Believe you can and you're halfway there.",
  "The secret of getting ahead is getting started.",
  "It always seems impossible until it's done.",
  "Focus on progress, not perfection.",
  "Small steps every day lead to big results.",
  "Done is better than perfect.",
  "Make today count.",
];

function labelStyle(label) {
  if (label === 'Top Priority') return 'background:#fff1f2;color:#be123c;border:1px solid #fecdd3;';
  if (label === 'Important')    return 'background:#fffbeb;color:#b45309;border:1px solid #fde68a;';
  return 'background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb;';
}

function formatDailyEmailHtml(plan, dayLabel) {
  const quote = QUOTES[new Date().getDay() % QUOTES.length];

  const blocks = (plan.blocks || []).map(block => {
    const items = (block.items || []).slice(0, 3);
    return `
      <div style="margin-bottom:12px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <div style="padding:12px 16px;background:#fafafa;border-bottom:1px solid #f0f0f0;">
          <div style="margin-bottom:6px;">
            <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;${labelStyle(block.label)}">${block.label || ''}</span>
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${block.color || '#6b7280'};vertical-align:middle;margin-left:8px;"></span>
            <span style="margin-left:4px;color:#6b7280;font-size:12px;">${block.project || ''}</span>
          </div>
          <p style="margin:0;font-size:15px;font-weight:600;color:#111827;">${block.task || ''}</p>
        </div>
        ${items.length ? `<div style="padding:10px 16px 6px;">${items.map(item => `<p style="margin:0 0 5px;color:#6b7280;font-size:13px;line-height:1.5;">· ${item}</p>`).join('')}</div>` : ''}
        ${block.reason ? `<div style="padding:2px 16px 10px;"><p style="margin:0;color:#9ca3af;font-size:12px;font-style:italic;">${block.reason}</p></div>` : ''}
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;">
        <tr>
          <td style="background:#111827;padding:24px 28px;border-radius:14px 14px 0 0;">
            <p style="margin:0 0 4px;color:#6b7280;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Planner</p>
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3;">${dayLabel}</h1>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:18px 28px;border-bottom:1px solid #f3f4f6;">
            <p style="margin:0;color:#9ca3af;font-size:13px;font-style:italic;">"${quote}"</p>
          </td>
        </tr>
        ${plan.summary ? `
        <tr>
          <td style="background:#ffffff;padding:16px 28px 12px;border-bottom:1px solid #f3f4f6;">
            <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">${plan.summary}</p>
          </td>
        </tr>` : ''}
        <tr>
          <td style="background:#ffffff;padding:20px 28px 24px;">
            <p style="margin:0 0 14px;color:#9ca3af;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Today's focus</p>
            ${blocks || '<p style="color:#9ca3af;font-size:14px;margin:0;">Nothing specific planned for today.</p>'}
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:14px 28px;border-top:1px solid #e5e7eb;border-radius:0 0 14px 14px;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">Sent by <strong style="color:#6366f1;">Planner</strong></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function generateAndCacheDailyPlan(userId, date) {
  const cached = db.prepare('SELECT plan_json FROM daily_plans WHERE user_id = ? AND date = ?').get(userId, date);
  if (cached) return JSON.parse(cached.plan_json);

  const projects = db.prepare(`
    SELECT id, name, color, priority, deadline, status
    FROM projects WHERE user_id = ? AND status != 'complete'
    ORDER BY priority DESC, deadline ASC NULLS LAST
  `).all(userId);

  if (!projects.length) return { summary: 'No active projects.', blocks: [] };

  // Read last 3 days of plans to know which tasks were recently recommended
  const recentPlans = db.prepare(
    'SELECT plan_json FROM daily_plans WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT 3'
  ).all(userId, date);
  const recentlyFeatured = new Set();
  for (const rp of recentPlans) {
    try {
      for (const block of (JSON.parse(rp.plan_json).blocks || []))
        if (block.task) recentlyFeatured.add(block.task.toLowerCase().trim());
    } catch {}
  }

  const projectsWithTasks = projects.map(p => {
    // Include all non-done tasks ordered by due date so AI has full variety
    const tasks = db.prepare(`
      SELECT t.id, t.title, t.status, t.due_date
      FROM tasks t WHERE t.project_id = ? AND t.status != 'done'
      ORDER BY t.due_date ASC NULLS LAST, t.id ASC
      LIMIT 8
    `).all(p.id);

    const enriched = tasks.map(t => {
      const pending = db.prepare(
        'SELECT text FROM checklist_items WHERE task_id = ? AND checked = 0 ORDER BY position ASC LIMIT 4'
      ).all(t.id).map(i => i.text);
      const doneCount = db.prepare(
        'SELECT COUNT(*) as c FROM checklist_items WHERE task_id = ? AND checked = 1'
      ).get(t.id)?.c || 0;
      return { ...t, pending, doneCount };
    });

    return { ...p, tasks: enriched };
  }).filter(p => p.tasks.length > 0);

  if (!projectsWithTasks.length) {
    return { summary: 'All tasks are done. Great work!', blocks: [] };
  }

  const recentNote = recentlyFeatured.size > 0
    ? `\nTasks featured in the LAST 3 DAYS — skip these today unless overdue or due today:\n${[...recentlyFeatured].map(t => `  - "${t}"`).join('\n')}\n`
    : '';

  const projectList = projectsWithTasks.map(p =>
    `Project: "${p.name}" (priority: ${p.priority}, deadline: ${p.deadline || 'none'}, color: ${p.color})\n` +
    p.tasks.map(t => {
      const due      = t.due_date ? ` | due: ${t.due_date}` : '';
      const progress = t.doneCount > 0 ? ` | ${t.doneCount} items already done` : '';
      const recent   = recentlyFeatured.has(t.title.toLowerCase().trim()) ? ' [FEATURED RECENTLY]' : '';
      const items    = t.pending.length ? `\n    Next items: ${t.pending.slice(0, 3).join(' | ')}` : '';
      return `  Task: "${t.title}" [${t.status}${due}${progress}${recent}]${items}`;
    }).join('\n')
  ).join('\n\n');

  const prompt = `Today is ${date}. You are a productivity coach building a daily work plan.

Projects and tasks:
${projectList}
${recentNote}
RULES — follow these strictly:
1. ROTATE: Never pick a task marked [FEATURED RECENTLY] unless its due date is today or it is overdue.
2. PROGRESS: A task with "items already done" has had attention — move to a DIFFERENT task today.
3. VARIETY: Pick tasks from at least 2 different projects when possible.
4. DEADLINES: Tasks with due_date = today or earlier are urgent — always include them.
5. ONE TASK PER PROJECT per day maximum (unless a project has an urgent + a normal task).
6. Suggest only 1-2 checklist items per task — not the whole list.

Respond ONLY with valid JSON, no markdown:
{
  "summary": "one encouraging sentence about today's focus",
  "blocks": [
    {
      "label": "Top Priority",
      "project": "exact project name",
      "color": "exact hex color from above",
      "task": "exact task title",
      "items": ["one specific checklist item to do today"],
      "reason": "one sentence: why this task today"
    }
  ]
}

Use labels: "Top Priority", "Important", "If time allows". Max 4 blocks.`;

  const raw = await chat(prompt, { json: true });
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI returned invalid JSON');
    parsed = JSON.parse(match[0]);
  }

  // Enrich blocks with IDs for clickable navigation in the UI
  if (parsed.blocks) {
    for (const block of parsed.blocks) {
      const proj = projects.find(p => p.name.toLowerCase() === block.project?.toLowerCase());
      if (proj) {
        block.project_id = proj.id;
        const task = db.prepare('SELECT id FROM tasks WHERE project_id = ? AND title = ? LIMIT 1').get(proj.id, block.task);
        if (task) block.task_id = task.id;
      }
    }
  }

  try {
    db.prepare('INSERT OR REPLACE INTO daily_plans (user_id, date, plan_json) VALUES (?, ?, ?)').run(userId, date, JSON.stringify(parsed));
  } catch (e) { console.warn('Could not persist daily plan:', e.message); }

  return parsed;
}

module.exports = { generateAndCacheDailyPlan, formatDailyEmailHtml };
