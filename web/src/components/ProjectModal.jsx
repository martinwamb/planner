import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { COLORS, PRIORITIES, STATUSES } from '../constants';
import { api } from '../api';

const EMPTY = {
  name: '', description: '', color: '#6366f1',
  priority: 'medium', status: 'planning',
  deadline: '', progress: 0, notes: '', tag_ids: [], github_repo: '',
};

function RepoSelector({ onSelect }) {
  const [repos, setRepos]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [query, setQuery]     = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listGitHubRepos();
      setRepos(data);
    } catch (err) {
      setError(err.status === 400 ? 'Configure a GitHub PAT first (GitHub icon in header).' : err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <p className="text-xs text-gray-400 py-1">Loading repos…</p>;
  if (error)   return <p className="text-xs text-rose-500 py-1">{error}</p>;
  if (!repos)  return null;

  const filtered = repos.filter(r => r.full_name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-1.5">
      <input
        type="text" value={query} onChange={e => setQuery(e.target.value)}
        placeholder="Search repos…"
        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
      <select size={Math.min(6, filtered.length || 1)} onChange={e => onSelect(e.target.value)}
        className="w-full border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
        {filtered.length === 0
          ? <option disabled>No repos found</option>
          : filtered.map(r => (
              <option key={r.full_name} value={r.full_name}>
                {r.private ? '🔒 ' : ''}{r.full_name}
              </option>
            ))
        }
      </select>
    </div>
  );
}

export default function ProjectModal({ project, allTags, onSave, onClose }) {
  const [form, setForm]         = useState(EMPTY);
  const [saving, setSaving]     = useState(false);
  const [showRepos, setShowRepos] = useState(false);

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
        github_repo: project.github_repo || '',
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

            {/* GitHub Repository */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                GitHub Repository <span className="text-xs text-gray-400 font-normal">(optional — auto-updates tasks from commits)</span>
              </label>
              {form.github_repo ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                    <svg className="w-4 h-4 text-gray-500 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                    </svg>
                    <span className="text-sm font-mono text-gray-700 truncate">{form.github_repo}</span>
                  </div>
                  <button type="button" onClick={() => { set('github_repo', ''); setShowRepos(false); }}
                    className="text-xs text-rose-500 hover:text-rose-700 px-2 py-1 rounded-lg hover:bg-rose-50 transition-colors whitespace-nowrap">
                    Unlink
                  </button>
                </div>
              ) : (
                <div>
                  {!showRepos ? (
                    <button type="button" onClick={() => setShowRepos(true)}
                      className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 border border-dashed border-gray-200 rounded-xl px-3 py-2 hover:border-gray-300 transition-colors w-full">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                      </svg>
                      Link a GitHub repo…
                    </button>
                  ) : (
                    <RepoSelector onSelect={repo => { set('github_repo', repo); setShowRepos(false); }} />
                  )}
                </div>
              )}
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
