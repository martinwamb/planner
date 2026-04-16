export const COLORS = [
  { label: 'Indigo',  value: '#6366f1' },
  { label: 'Blue',    value: '#3b82f6' },
  { label: 'Cyan',    value: '#06b6d4' },
  { label: 'Emerald', value: '#10b981' },
  { label: 'Amber',   value: '#f59e0b' },
  { label: 'Rose',    value: '#f43f5e' },
  { label: 'Purple',  value: '#a855f7' },
  { label: 'Slate',   value: '#64748b' },
];

export const PRIORITIES = [
  { value: 'low',    label: 'Low',    dot: 'bg-slate-400' },
  { value: 'medium', label: 'Medium', dot: 'bg-amber-400' },
  { value: 'high',   label: 'High',   dot: 'bg-rose-500' },
];

export const STATUSES = [
  { value: 'planning',   label: 'Planning',   bg: 'bg-slate-100',   text: 'text-slate-600' },
  { value: 'active',     label: 'Active',     bg: 'bg-blue-50',     text: 'text-blue-700'  },
  { value: 'on-hold',    label: 'On Hold',    bg: 'bg-amber-50',    text: 'text-amber-700' },
  { value: 'complete',   label: 'Complete',   bg: 'bg-emerald-50',  text: 'text-emerald-700' },
];

export function getStatus(value) {
  return STATUSES.find(s => s.value === value) || STATUSES[0];
}

export function getPriority(value) {
  return PRIORITIES.find(p => p.value === value) || PRIORITIES[1];
}

export function formatDeadline(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  const formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  if (diffDays < 0) return { text: formatted, overdue: true, diffDays };
  if (diffDays === 0) return { text: 'Today', overdue: false, diffDays };
  if (diffDays <= 7) return { text: `${diffDays}d left`, overdue: false, diffDays, soon: true };
  return { text: formatted, overdue: false, diffDays };
}
