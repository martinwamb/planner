// One-shot script: generate a today + week plan and print to stdout
// Usage: node scripts/weekly-plan.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db   = require('../db');
const { chat } = require('../ollama');

const USER_ID = 1;
const TODAY   = new Date().toISOString().split('T')[0]; // 2026-04-17

async function run() {
  const projects = db.prepare(`
    SELECT id, name, color, priority, deadline, status
    FROM projects WHERE user_id = ? AND status != 'complete'
    ORDER BY priority DESC, deadline ASC
  `).all(USER_ID);

  const withTasks = projects.map(p => {
    const tasks = db.prepare(
      "SELECT id, title, status FROM tasks WHERE project_id = ? AND status != 'done'"
    ).all(p.id);

    const enriched = tasks.map(t => {
      const items = db.prepare(
        'SELECT text FROM checklist_items WHERE task_id = ? AND checked = 0 ORDER BY position LIMIT 5'
      ).all(t.id).map(i => i.text);
      return { ...t, items };
    });

    return { ...p, tasks: enriched };
  }).filter(p => p.tasks.length);

  if (!withTasks.length) {
    console.log('No active projects with pending tasks.');
    return;
  }

  const projectList = withTasks.map(p =>
    `Project: "${p.name}" (priority: ${p.priority}, deadline: ${p.deadline || 'none'})\n` +
    p.tasks.map(t =>
      `  Task: "${t.title}" [${t.status}]` +
      (t.items.length ? `\n    Pending: ${t.items.slice(0, 3).join(' | ')}` : '')
    ).join('\n')
  ).join('\n\n');

  const prompt = `Today is ${TODAY} (Thursday). Plan today and the rest of this working week.

Active projects and tasks:
${projectList}

Give a practical daily focus plan. Today is Thursday 17 Apr; the remaining days this week are Fri 18 Apr. Next week starts Mon 21 Apr.

Respond ONLY with valid JSON, no markdown:
{
  "today": [
    {"project": "project name", "task": "task title", "focus": "specific thing to work on today", "priority": "high/medium/low"}
  ],
  "week": [
    {"day": "Fri 18 Apr", "project": "name", "focus": "what to focus on"},
    {"day": "Mon 21 Apr", "project": "name", "focus": "what to focus on"},
    {"day": "Tue 22 Apr", "project": "name", "focus": "what to focus on"},
    {"day": "Wed 23 Apr", "project": "name", "focus": "what to focus on"},
    {"day": "Thu 24 Apr", "project": "name", "focus": "what to focus on"}
  ],
  "summary": "one sentence overview of the week's priorities"
}`;

  console.log('Generating weekly plan... (this takes a few minutes)');
  const raw = await chat(prompt, { json: true });

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  }

  if (!parsed) {
    console.log('Raw AI response:\n', raw);
    return;
  }

  console.log('\n========================================');
  console.log('  TODAY — Thursday 17 April 2026');
  console.log('========================================');
  (parsed.today || []).forEach(item => {
    console.log(`\n[${item.priority?.toUpperCase() || 'FOCUS'}] ${item.project}`);
    console.log(`  Task: ${item.task}`);
    console.log(`  Focus: ${item.focus}`);
  });

  console.log('\n========================================');
  console.log('  REST OF WEEK');
  console.log('========================================');
  (parsed.week || []).forEach(day => {
    console.log(`\n${day.day}:`);
    if (day.project) console.log(`  Project: ${day.project}`);
    console.log(`  ${day.focus}`);
  });

  if (parsed.summary) {
    console.log('\n---');
    console.log('Summary:', parsed.summary);
  }

  console.log('\nPLAN_DONE');
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
