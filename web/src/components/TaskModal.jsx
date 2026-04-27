import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';

const EMPTY = {
  title: '', status: 'todo', raw_notes: '',
  start_date: '', due_date: '',
  problem_statement: '',
  quadrant_quick_win: [], quadrant_fill_in: [],
  quadrant_big_bet:   [], quadrant_avoid: [],
  checklist: [],
};

const STATUSES = [
  { value: 'todo',        label: 'To Do' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'review',      label: 'Review' },
  { value: 'done',        label: 'Done' },
];

const QUADRANTS = [
  { key: 'quadrant_quick_win', label: 'Quick Wins',  sub: 'Easy + High Value',   color: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  { key: 'quadrant_fill_in',   label: 'Fill-ins',    sub: 'Easy + Lower Value',  color: 'bg-blue-50 border-blue-200',       badge: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-400'   },
  { key: 'quadrant_big_bet',   label: 'Big Bets',    sub: 'Hard + High Value',   color: 'bg-amber-50 border-amber-200',     badge: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500'  },
  { key: 'quadrant_avoid',     label: 'Avoid',       sub: 'Hard + Low Value',    color: 'bg-rose-50 border-rose-200',       badge: 'bg-rose-100 text-rose-700',       dot: 'bg-rose-400'   },
];

export default function TaskModal({ task, projectId, onSave, onClose }) {
  const [form, setForm]               = useState(EMPTY);
  const [saving, setSaving]           = useState(false);
  const [enhancing, setEnhancing]     = useState(false);
  const [suggestingDates, setSuggestingDates] = useState(false);
  const [dateReason, setDateReason]   = useState('');
  const [newCheck, setNewCheck]       = useState('');
  const [tab, setTab]                 = useState('summary'); // 'summary' | 'notes'

  useEffect(() => {
    if (task) {
      const hasNew = task.problem_statement || task.quadrant_quick_win?.length;
      setForm({
        title:               task.title || '',
        status:              task.status || 'todo',
        raw_notes:           task.raw_notes || '',
        start_date:          task.start_date || '',
        due_date:            task.due_date || '',
        problem_statement:   task.problem_statement || '',
        quadrant_quick_win:  [...(task.quadrant_quick_win || [])],
        quadrant_fill_in:    [...(task.quadrant_fill_in   || [])],
        quadrant_big_bet:    [...(task.quadrant_big_bet   || [])],
        quadrant_avoid:      [...(task.quadrant_avoid     || [])],
        checklist:           task.checklist?.map(c => ({ ...c })) || [],
      });
      setTab(hasNew ? 'summary' : 'notes');
    }
  }, [task]);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  function updateBullet(qkey, idx, value) {
    setForm(f => { const arr = [...f[qkey]]; arr[idx] = value; return { ...f, [qkey]: arr }; });
  }
  function addBullet(qkey)         { setForm(f => ({ ...f, [qkey]: [...f[qkey], ''] })); }
  function removeBullet(qkey, idx) { setForm(f => ({ ...f, [qkey]: f[qkey].filter((_, i) => i !== idx) })); }

  function addCheckItem() {
    if (!newCheck.trim()) return;
    setForm(f => ({ ...f, checklist: [...f.checklist, { text: newCheck.trim(), checked: false }] }));
    setNewCheck('');
  }
  function toggleCheck(idx) {
    setForm(f => { const l = [...f.checklist]; l[idx] = { ...l[idx], checked: !l[idx].checked }; return { ...f, checklist: l }; });
  }
  function removeCheck(idx) { setForm(f => ({ ...f, checklist: f.checklist.filter((_, i) => i !== idx) })); }

  async function handleEnhance() {
    if (!form.title.trim() && !form.raw_notes.trim()) return;
    setEnhancing(true);
    try {
      const result = await api.enhanceTask({ notes: form.raw_notes || form.title, title: form.title, projectId });
      setForm(f => ({
        ...f,
        problem_statement:  result.problem_statement  || f.problem_statement,
        quadrant_quick_win: result.quadrant_quick_win || f.quadrant_quick_win,
        quadrant_fill_in:   result.quadrant_fill_in   || f.quadrant_fill_in,
        quadrant_big_bet:   result.quadrant_big_bet   || f.quadrant_big_bet,
        quadrant_avoid:     result.quadrant_avoid     || f.quadrant_avoid,
        checklist: result.checklist
          ? result.checklist.map(text => ({ text, checked: false }))
          : f.checklist,
        start_date: result.start_date || f.start_date,
        due_date:   result.due_date   || f.due_date,
      }));
      if (result.start_date || result.due_date) setDateReason('Dates suggested by AI during enhancement.');
      setTab('summary');
    } catch (err) {
      alert('AI enhancement failed: ' + (err.message || 'Unknown error'));
    } finally { setEnhancing(false); }
  }

  async function handleSuggestDates() {
    if (!form.title.trim()) return;
    setSuggestingDates(true);
    setDateReason('');
    try {
      const result = await api.suggestTimeline({ taskTitle: form.title, taskNotes: form.raw_notes, projectId });
      if (result.start_date) set('start_date', result.start_date);
      if (result.due_date)   set('due_date',   result.due_date);
      if (result.reason)     setDateReason(result.reason);
    } catch (err) {
      alert('Could not suggest dates: ' + (err.message || 'AI unavailable'));
    } finally { setSuggestingDates(false); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  }

  const checkDone  = form.checklist.filter(c => c.checked).length;
  const checkTotal = form.checklist.length;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">{task ? 'Edit Task' : 'New Task'}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
            {/* Title + status */}
            <div className="flex flex-col sm:flex-row gap-3">
              <input type="text" value={form.title} onChange={e => set('title', e.target.value)}
                placeholder="Task title" required
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {/* Timeline */}
            <div className="border border-gray-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">Timeline</span>
                <button type="button" onClick={handleSuggestDates} disabled={suggestingDates || !form.title.trim()}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50">
                  {suggestingDates ? '✦ Thinking…' : '✦ Suggest with AI'}
                </button>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1 block">Start date</label>
                  <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1 block">Due date</label>
                  <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
              {dateReason && <p className="text-xs text-indigo-500 italic">{dateReason}</p>}
            </div>

            {/* Tab switcher */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
              {[['notes', 'Raw Notes'], ['summary', 'Task Summary']].map(([t, label]) => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Raw Notes tab ── */}
            {tab === 'notes' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Notes</label>
                  <button type="button" onClick={handleEnhance} disabled={enhancing}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50">
                    {enhancing ? 'Enhancing…' : '✦ Enhance with AI'}
                  </button>
                </div>
                <textarea value={form.raw_notes} onChange={e => set('raw_notes', e.target.value)}
                  rows={5} placeholder="Write rough notes here, then use AI to generate the Task Summary…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
              </div>
            )}

            {/* ── Task Summary tab ── */}
            {tab === 'summary' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">SMART problem statement + effort-value matrix</p>
                  <button type="button" onClick={handleEnhance} disabled={enhancing}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50">
                    {enhancing ? 'Enhancing…' : '✦ Generate with AI'}
                  </button>
                </div>

                {/* Problem Statement */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">Problem Statement</span>
                    <span className="text-xs text-gray-400">SMART: Specific · Measurable · Attainable · Time-bound</span>
                  </div>
                  <textarea value={form.problem_statement} onChange={e => set('problem_statement', e.target.value)}
                    rows={2} placeholder='How do we [specific goal] by [measurable output] within [time frame]?'
                    className="w-full text-sm text-gray-800 border-0 focus:outline-none resize-none bg-transparent placeholder:text-gray-300 leading-relaxed" />
                </div>

                {/* 4-Quadrant Grid */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Effort–Value Matrix</p>
                  <div className="grid grid-cols-2 gap-3">
                    {QUADRANTS.map(q => (
                      <div key={q.key} className={`border rounded-xl p-3 ${q.color}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${q.dot}`} />
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${q.badge}`}>{q.label}</span>
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5 ml-3.5">{q.sub}</p>
                          </div>
                          <button type="button" onClick={() => addBullet(q.key)}
                            className="text-xs text-gray-400 hover:text-gray-700">+</button>
                        </div>
                        {form[q.key].length === 0 && (
                          <p className="text-xs text-gray-300 italic">Use AI to generate</p>
                        )}
                        {form[q.key].map((bullet, idx) => (
                          <div key={idx} className="flex items-start gap-1.5 mb-1.5">
                            <span className="text-gray-300 text-xs mt-0.5 flex-shrink-0">·</span>
                            <input type="text" value={bullet} onChange={e => updateBullet(q.key, idx, e.target.value)}
                              placeholder="approach item"
                              className="flex-1 text-xs text-gray-700 bg-transparent border-b border-gray-200 focus:outline-none focus:border-indigo-400 py-0.5" />
                            <button type="button" onClick={() => removeBullet(q.key, idx)}
                              className="text-gray-300 hover:text-rose-400 text-xs flex-shrink-0">✕</button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Checklist items are derived from <span className="text-emerald-600 font-medium">Quick Wins</span></p>
                </div>
              </div>
            )}

            {/* Checklist */}
            <div className="border border-gray-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">Checklist</span>
                {checkTotal > 0 && <span className="text-xs text-gray-400">{checkDone}/{checkTotal} done</span>}
              </div>
              {checkTotal > 0 && (
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(checkDone / checkTotal) * 100}%` }} />
                </div>
              )}
              <div className="space-y-2">
                <AnimatePresence>
                  {form.checklist.map((item, idx) => (
                    <motion.div key={idx} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
                      className="flex items-center gap-2 group">
                      <input type="checkbox" checked={item.checked} onChange={() => toggleCheck(idx)} className="rounded accent-indigo-500 flex-shrink-0" />
                      <span className={`text-sm flex-1 ${item.checked ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item.text}</span>
                      <button type="button" onClick={() => removeCheck(idx)}
                        className="text-gray-300 hover:text-rose-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="flex gap-2 pt-1">
                <input type="text" value={newCheck} onChange={e => setNewCheck(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCheckItem())}
                  placeholder="Add checklist item…"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <button type="button" onClick={addCheckItem}
                  className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">+ Add</button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
              <button type="submit" disabled={saving || !form.title.trim()}
                className="flex-1 bg-gray-900 text-white rounded-xl py-2 text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : task ? 'Save Changes' : 'Create Task'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
