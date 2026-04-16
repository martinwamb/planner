import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { COLORS, PRIORITIES, STATUSES } from '../constants';

const EMPTY = {
  name: '', description: '', color: '#6366f1',
  priority: 'medium', status: 'planning',
  deadline: '', progress: 0, notes: '', tag_ids: [],
};

export default function ProjectModal({ project, allTags, onSave, onClose }) {
  const [form, setForm]   = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project) {
      setForm({
        name:        project.name        || '',
        description: project.description || '',
        color:       project.color       || '#6366f1',
        priority:    project.priority    || 'medium',
        status:      project.status      || 'planning',
        deadline:    project.deadline    || '',
        progress:    project.progress    ?? 0,
        notes:       project.notes       || '',
        tag_ids:     project.tags?.map(t => t.id) || [],
      });
    }
  }, [project]);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  function toggleTag(id) {
    setForm(f => ({
      ...f,
      tag_ids: f.tag_ids.includes(id) ? f.tag_ids.filter(t => t !== id) : [...f.tag_ids, id],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try { await onSave({ ...form, progress: Number(form.progress) }); }
    finally { setSaving(false); }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">
              {project ? 'Edit Project' : 'New Project'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none">✕</button>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
              <input
                type="text" value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="e.g. Brand Redesign" required
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description} onChange={e => set('description', e.target.value)}
                rows={2} placeholder="Brief overview…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
              />
            </div>

            {/* Priority + Status */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select value={form.priority} onChange={e => set('priority', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                  {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                  {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {/* Deadline */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
              <input type="date" value={form.deadline} onChange={e => set('deadline', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>

            {/* Progress */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Progress — <span className="text-indigo-600 font-semibold">{form.progress}%</span>
              </label>
              <input type="range" min={0} max={100} value={form.progress}
                onChange={e => set('progress', e.target.value)} className="w-full accent-indigo-500" />
            </div>

            {/* Color */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map(c => (
                  <button key={c.value} type="button" onClick={() => set('color', c.value)} title={c.label}
                    className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                    style={{ backgroundColor: c.value, outline: form.color === c.value ? `3px solid ${c.value}` : '3px solid transparent', outlineOffset: '2px' }}
                  />
                ))}
              </div>
            </div>

            {/* Tags */}
            {allTags?.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tags</label>
                <div className="flex flex-wrap gap-2">
                  {allTags.map(tag => (
                    <button
                      key={tag.id} type="button" onClick={() => toggleTag(tag.id)}
                      className="text-xs px-3 py-1 rounded-full font-medium transition-all border-2"
                      style={{
                        backgroundColor: form.tag_ids.includes(tag.id) ? tag.color : 'transparent',
                        color: form.tag_ids.includes(tag.id) ? '#fff' : tag.color,
                        borderColor: tag.color,
                      }}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
                placeholder="Additional context, links, thoughts…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving || !form.name.trim()}
                className="flex-1 bg-gray-900 text-white rounded-xl py-2 text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : project ? 'Save Changes' : 'Create Project'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
