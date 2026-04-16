import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LABEL_COLORS = {
  'Top Priority': 'bg-rose-50 border-rose-200 text-rose-700',
  'Important':    'bg-amber-50 border-amber-200 text-amber-700',
  'If time allows': 'bg-gray-50 border-gray-200 text-gray-600',
};

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

export default function CalendarView({ projects }) {
  const today = new Date();
  const [cursor, setCursor]     = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(null);
  const [plans, setPlans]       = useState({});  // date → plan
  const [loading, setLoading]   = useState(null); // date loading

  // Build deadline map: date → [project colors]
  const deadlineMap = {};
  for (const p of projects) {
    if (p.deadline && p.status !== 'complete') {
      deadlineMap[p.deadline] = deadlineMap[p.deadline] || [];
      deadlineMap[p.deadline].push(p.color);
    }
  }

  // Calendar grid
  const year  = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay  = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  async function selectDate(date) {
    const key = isoDate(date);
    setSelected(key);
    if (plans[key]) return; // already fetched
    setLoading(key);
    try {
      const plan = await api.getDailyPlan(key);
      setPlans(p => ({ ...p, [key]: plan }));
    } catch {
      setPlans(p => ({ ...p, [key]: { error: 'AI unavailable', blocks: [] } }));
    } finally {
      setLoading(null);
    }
  }

  const plan = selected ? plans[selected] : null;
  const todayStr = isoDate(today);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Calendar */}
      <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 p-5">
        {/* Month nav */}
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="text-gray-400 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors text-sm">
            ←
          </button>
          <span className="text-sm font-semibold text-gray-900">
            {cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="text-gray-400 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors text-sm">
            →
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-2">
          {DAYS.map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Date cells */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <div key={`e-${i}`} />;
            const key = isoDate(date);
            const isToday    = key === todayStr;
            const isSelected = key === selected;
            const dots       = deadlineMap[key] || [];
            const isPast     = date < today && !isToday;

            return (
              <button key={key} onClick={() => selectDate(date)}
                className={`relative aspect-square flex flex-col items-center justify-center rounded-xl text-sm font-medium transition-all
                  ${isSelected  ? 'bg-gray-900 text-white shadow-sm'
                  : isToday     ? 'bg-indigo-500 text-white shadow-sm'
                  : isPast      ? 'text-gray-300 hover:bg-gray-50'
                  :               'text-gray-700 hover:bg-gray-50'}`}
              >
                {date.getDate()}
                {dots.length > 0 && (
                  <div className="flex gap-0.5 mt-0.5">
                    {dots.slice(0, 3).map((color, j) => (
                      <span key={j} className="w-1 h-1 rounded-full"
                        style={{ backgroundColor: isSelected ? 'rgba(255,255,255,0.7)' : color }} />
                    ))}
                  </div>
                )}
                {loading === key && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="w-3 h-3 border border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t border-gray-50 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-indigo-500" />
            <span className="text-xs text-gray-400">Today</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <span className="text-xs text-gray-400">Project deadline</span>
          </div>
          <span className="text-xs text-gray-400 ml-auto">Click any date for AI daily plan</span>
        </div>
      </div>

      {/* Daily plan panel */}
      <div className="lg:col-span-2">
        <AnimatePresence mode="wait">
          {!selected ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="bg-white rounded-2xl border border-gray-100 p-6 h-full flex flex-col items-center justify-center text-center min-h-[300px]">
              <p className="text-3xl mb-3">📅</p>
              <p className="text-sm font-medium text-gray-700 mb-1">Select a date</p>
              <p className="text-xs text-gray-400">AI will generate a focused task plan for that day based on your projects and deadlines.</p>
            </motion.div>
          ) : loading === selected ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="bg-white rounded-2xl border border-gray-100 p-6 min-h-[300px] flex flex-col items-center justify-center gap-3">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Generating your plan…</p>
            </motion.div>
          ) : plan ? (
            <motion.div key={selected} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 border-b border-gray-50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                  {new Date(selected + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
                {plan.summary && <p className="text-sm text-gray-700 leading-relaxed">{plan.summary}</p>}
                {plan.error && <p className="text-sm text-rose-500">{plan.error}</p>}
              </div>

              {/* Blocks */}
              <div className="divide-y divide-gray-50">
                {plan.blocks?.map((block, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07 }}
                    className="px-5 py-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${LABEL_COLORS[block.label] || 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                        {block.label}
                      </span>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: block.color }} />
                      <span className="text-xs text-gray-500 truncate">{block.project}</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{block.task}</p>
                    {block.items?.length > 0 && (
                      <ul className="space-y-1">
                        {block.items.map((item, j) => (
                          <li key={j} className="flex items-start gap-2 text-xs text-gray-600">
                            <span className="text-gray-300 flex-shrink-0 mt-0.5">—</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                    {block.reason && (
                      <p className="text-xs text-gray-400 italic">{block.reason}</p>
                    )}
                  </motion.div>
                ))}
              </div>

              {plan.blocks?.length === 0 && !plan.error && (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  Nothing specific planned for this day.
                </div>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
