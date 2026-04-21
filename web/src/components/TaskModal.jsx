import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';

const EMPTY = {
  title: '', status: 'todo', raw_notes: '',
  start_date: '', due_date: '',
  context: [], purpose: [], outcome: [], approach: [], checklist: [],
};

const SECTIONS = [
  { key: 'context',  label: 'Context',  hint: 'Background & situation' },
  { key: 'purpose',  label: 'Purpose',  hint: 'Why this task matters' },
  { key: 'outcome',  label: 'Outcome',  hint: 'What success looks like' },
  { key: 'approach', label: 'Approach', hint: 'How to execute' },
];

const STATUSES = [
  { value: 'todo',        label: 'To Do' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'review',      label: 'Review' },
  { value: 'done',        label: 'Done' },
];

export default function TaskModal({ task, projectId, onSave, onClose }) {
  const [form, setForm]               = useState(EMPTY);
  const [saving, setSaving]           = useState(false);
  const [enhancing, setEnhancing]     = useState(false);
  const [suggestingDates, setSuggestingDates] = useState(false);
  const [dateReason, setDateReason]   = useState('');
  const [newCheck, setNewCheck]       = useState('');
  const [tab, setTab]                 = useState('structured'); // 'structured' | 'notes'

  useEffect(() => {
    if (task) {
      setForm({
        title:      task.title || '',
        status:     task.status || 'todo',
        raw_notes:  task.raw_notes || '',
        start_date: task.start_date || '',
        due_date:   task.due_date || '',
        context:    [...(task.context  || [])],
        purpose:    [...(task.purpose  || [])],
        outcome:    [...(task.outcome  || [])],
        approach:   [...(task.approach || [])],
        checklist:  task.checklist?.map(c => ({ ...c })) || [],
      });
      if (task.context?.length || task.purpose?.length) setTab('structured');
      else setTab('notes');
    }
  }, [task]);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  function updateBullet(section, idx, value) {
    setForm(f => {
      const arr = [...f[section]];
      arr[idx] = value;
      return { ...f, [section]: arr };
    });
  }

  function addBullet(section) { setForm(f => ({ ...f, [section]: [...f[section], ''] })); }
  function removeBullet(section, idx) { setForm(f => ({ ...f, [section]: f[section].filter((_, i) => i !== idx) })); }

  function addCheckItem() {
    if (!newCheck.trim()) return;
    setForm(f => ({ ...f, checklist: [...f.checklist, { text: newCheck.trim(), checked: false }] }));
    setNewCheck('');
  }

  function toggleCheck(idx) {
    setForm(f => {
      const list = [...f.checklist];
      list[idx] = { ...list[idx], checked: !list[idx].checked };
      return { ...f, checklist: list };
    });
  }

  function removeCheck(idx) { setForm(f => ({ ...f, checklist: f.checklist.filter((_, i) => i !== idx) })); }

  async function handleEnhance() {
    if (!form.raw_notes.trim() && !form.title.trim()) return;
    setEnhancing(true);
    try {
      const result = await api.enhanceTask({ notes: form.raw_notes || form.title, title: form.title });
      setForm(f => ({
        ...f,
        context:  result.context  || f.context,
        purpose:  result.purpose  || f.purpose,
        outcome:  result.outcome  || f.outcome,
        approach: result.approach || f.approach,
        checklist: result.checklist
          ? result.checklist.map(text => ({ text, checked: false }))
          : f.checklist,
      }));
      setTab('structured');
    } catch (err) {
      alert('AI enhancement failed: ' + (err.message || 'Unknown error'));
    } finally {
      setEnhancing(false);
    }
  }

  async function handleSuggestDates() {
    if (!form.title.trim()) return;
    setSuggestingDates(true);
    setDateReason('');
    try {
      const result = await api.suggestTimeline({
        taskTitle: form.title,
        taskNotes: form.raw_notes,
        projectId,
      });
      if (result.start_date) set('start_date', result.start_date);
      if (result.due_date)   set('due_date',   result.due_date);
      if (result.reason)     setDateReason(result.reason);
    } catch (err) {
      alert('Could not suggest dates: ' + (err.message || 'AI unavailable'));
    } finally {
      setSuggestingDates(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try { await onSave(form); }
    finally { setSaving(false); }
  }

  const checkDone  = form.checklist.filter(c => c.checked).length;
  const checkTotal = form.checklist.length;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">{task ? 'Edit Task' : 'New Task'}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none">✕</button>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
            {/* Title + status */}
            <div className="flex flex-col sm:flex-row gap-3">
              <input type="text" value={form.title} onChange={e => set('title', e.target.value)}
                placeholder="Task title" required
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {/* Dates */}
            <div className="border border-gray-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">Timeline</span>
                <button type="button" onClick={handleSuggestDates}
                  disabled={suggestingDates || !form.title.trim()}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 disabled:opacity-50">
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
              {dateReason && (
                <p className="text-xs text-indigo-500 italic">{dateReason}</p>
              )}
            </div>

            {/* Tab switcher */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
              {['notes', 'structured'].map(t => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t === 'notes' ? 'Raw Notes' : 'Structured'}
                </button>
              ))}
            </div>

            {tab === 'notes' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Notes</label>
                  <button type="button" onClick={handleEnhance} disabled={enhancing}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 disabled:opacity-50">
                    {enhancing ? 'Enhancing…' : '✦ Enhance with AI'}
                  </button>
                </div>
                <textarea value={form.raw_notes} onChange={e => set('raw_notes', e.target.value)}
                  rows={5} placeholder="Write rough notes here, then use AI to structure them…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
              </div>
            )}

            {tab === 'structured' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">AI-structured task breakdown</p>
                  <button type="button" onClick={handleEnhance} disabled={enhancing}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 disabled:opacity-50">
                    {enhancing ? 'Enhancing…' : '✦ Re-enhance with AI'}
                  </button>
                </div>
                {SECTIONS.map(section => (
                  <div key={section.key} className="border border-gray-100 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-semibold text-gray-800">{section.label}</span>
                        <span className="text-xs text-gray-400 ml-2">{section.hint}</span>
                      </div>
                      <button type="button" onClick={() => addBullet(section.key)}
                        className="text-xs text-indigo-600 hover:text-indigo-800">+ Add</button>
                    </div>
                    {form[section.key].length === 0 && (
                      <p className="text-xs text-gray-300 italic">No bullets yet — use AI Enhance or add manually</p>
                    )}
                    {form[section.key].map((bullet, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-gray-300 text-xs flex-shrink-0">—</span>
                        <input type="text" value={bullet} onChange={e => updateBullet(section.key, idx, e.target.value)}
                          placeholder="8–10 word bullet point"
                          className="flex-1 text-sm text-gray-700 border-b border-gray-200 focus:outline-none focus:border-indigo-400 py-0.5 bg-transparent" />
                        <button type="button" onClick={() => removeBullet(section.key, idx)}
                          className="text-gray-300 hover:text-rose-400 text-xs">✕</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Checklist */}
            <div className="border border-gray-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">Checklist</span>
                {checkTotal > 0 && (
                  <span className="text-xs text-gray-400">{checkDone}/{checkTotal} done</span>
                )}
              </div>
              {checkTotal > 0 && (
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${(checkDone / checkTotal) * 100}%` }} />
                </div>
              )}
              <div className="space-y-2">
                <AnimatePresence>
                  {form.checklist.map((item, idx) => (
                    <motion.div key={idx} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
                      className="flex items-center gap-2 group">
                      <input type="checkbox" checked={item.checked} onChange={() => toggleCheck(idx)}
                        className="rounded accent-indigo-500 flex-shrink-0" />
                      <span className={`text-sm flex-1 ${item.checked ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                        {item.text}
                      </span>
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
                  className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  + Add
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
                Cancel
              </button>
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
