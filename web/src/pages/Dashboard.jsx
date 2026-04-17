import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import ProjectCard from '../components/ProjectCard';
import ProjectModal from '../components/ProjectModal';
import TagManager from '../components/TagManager';
import CalendarView from '../components/CalendarView';
import { STATUSES } from '../constants';

const FILTER_OPTIONS = [{ value: 'all', label: 'All' }, ...STATUSES];

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [projects, setProjects]   = useState([]);
  const [tags, setTags]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter]       = useState(null);
  const [showTagMgr, setShowTagMgr]     = useState(false);
  const [aiPanel, setAiPanel]           = useState(null);
  const [aiLoading, setAiLoading]       = useState(false);
  const [view, setView]                 = useState('projects'); // 'projects' | 'calendar'

  useEffect(() => {
    Promise.all([api.getProjects(), api.getTags()])
      .then(([p, t]) => { setProjects(p); setTags(t); })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(form) {
    if (modal?.id) {
      const updated = await api.updateProject(modal.id, form);
      setProjects(ps => ps.map(p => p.id === updated.id ? updated : p));
    } else {
      const created = await api.createProject(form);
      setProjects(ps => [created, ...ps]);
    }
    setModal(null);
  }

  async function confirmDelete() {
    await api.deleteProject(deleteTarget.id);
    setProjects(ps => ps.filter(p => p.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  async function handleAIPriorities() {
    setAiLoading(true);
    setAiPanel(null);
    try {
      const result = await api.suggestPriorities();
      setAiPanel(result);
    } catch { setAiPanel({ error: 'AI unavailable. Make sure Ollama is running.' }); }
    finally { setAiLoading(false); }
  }

  async function handleSendDigest() {
    setAiLoading(true);
    try {
      await api.sendWeeklyDigest();
      setAiPanel({ digest_sent: 'weekly' });
    } catch { setAiPanel({ error: 'Failed to send digest.' }); }
    finally { setAiLoading(false); }
  }

  async function handleSendDailyDigest() {
    setAiLoading(true);
    try {
      await api.sendDailyDigest();
      setAiPanel({ digest_sent: 'daily' });
    } catch { setAiPanel({ error: 'Failed to send daily plan.' }); }
    finally { setAiLoading(false); }
  }

  // Filtering
  let filtered = statusFilter === 'all' ? projects : projects.filter(p => p.status === statusFilter);
  if (tagFilter) filtered = filtered.filter(p => p.tags?.some(t => t.id === tagFilter));

  const stats = {
    total:    projects.length,
    active:   projects.filter(p => p.status === 'active').length,
    complete: projects.filter(p => p.status === 'complete').length,
    overdue:  projects.filter(p => {
      if (!p.deadline || p.status === 'complete') return false;
      return new Date(p.deadline + 'T00:00:00') < new Date();
    }).length,
  };

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6">
          {/* Top row */}
          <div className="py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="Planner" className="w-9 h-9 rounded-xl" />
              <div>
                <h1 className="text-xl font-bold text-gray-900 tracking-tight">Planner</h1>
                <p className="text-xs text-gray-400">Welcome back, {user?.name?.split(' ')[0]}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleAIPriorities} disabled={aiLoading}
                className="text-sm text-indigo-600 hover:text-indigo-800 px-3 py-2 rounded-lg hover:bg-indigo-50 transition-colors font-medium disabled:opacity-50">
                {aiLoading ? '…' : '✦ AI Insights'}
              </button>
              <button onClick={handleSendDailyDigest} disabled={aiLoading}
                className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors hidden sm:block">
                Today's plan
              </button>
              <button onClick={handleSendDigest} disabled={aiLoading}
                className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors hidden sm:block">
                Weekly digest
              </button>
              <button onClick={() => setModal('create')}
                className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-gray-700 transition-colors">
                + New Project
              </button>
              <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded transition-colors">
                Sign out
              </button>
            </div>
          </div>
          {/* View tabs row */}
          <div className="flex gap-0 border-t border-gray-100">
            {[['projects', 'Projects'], ['calendar', 'Calendar']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-all ${
                  view === v
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total',    value: stats.total,    color: 'text-gray-900' },
            { label: 'Active',   value: stats.active,   color: 'text-blue-600' },
            { label: 'Complete', value: stats.complete, color: 'text-emerald-600' },
            { label: 'Overdue',  value: stats.overdue,  color: 'text-rose-500' },
          ].map((stat, i) => (
            <motion.div key={stat.label}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
              className="bg-white rounded-xl border border-gray-100 px-5 py-4">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{stat.label}</p>
              <p className={`text-3xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            </motion.div>
          ))}
        </div>

        {/* AI Panel */}
        <AnimatePresence>
          {aiPanel && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="bg-white rounded-xl border border-indigo-100 overflow-hidden">
              <div className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">✦ AI Insights</h3>
                  <button onClick={() => setAiPanel(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                </div>
                {aiPanel.error && <p className="text-sm text-rose-500">{aiPanel.error}</p>}
                {aiPanel.digest_sent === 'weekly' && <p className="text-sm text-emerald-600">Weekly digest sent to your email.</p>}
                {aiPanel.digest_sent === 'daily'  && <p className="text-sm text-emerald-600">Today's plan sent to your email.</p>}
                {aiPanel.summary && <p className="text-sm text-gray-700 mb-4">{aiPanel.summary}</p>}
                <div className="grid sm:grid-cols-3 gap-4">
                  {aiPanel.top_priority?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-2">Focus this week</p>
                      <ul className="space-y-1">
                        {aiPanel.top_priority.map((item, i) => (
                          <li key={i} className="text-xs text-gray-700 flex gap-1.5"><span className="text-indigo-400 flex-shrink-0">→</span>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {aiPanel.at_risk?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-rose-500 uppercase tracking-wide mb-2">At risk</p>
                      <ul className="space-y-1">
                        {aiPanel.at_risk.map((item, i) => (
                          <li key={i} className="text-xs text-gray-700 flex gap-1.5"><span className="text-rose-400 flex-shrink-0">⚠</span>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {aiPanel.suggestions?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-2">Suggestions</p>
                      <ul className="space-y-1">
                        {aiPanel.suggestions.map((item, i) => (
                          <li key={i} className="text-xs text-gray-700 flex gap-1.5"><span className="text-emerald-400 flex-shrink-0">✓</span>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter bar — projects view only */}
        {view === 'projects' && (<div className="flex flex-wrap items-center gap-3">
          {/* Status filter */}
          <div className="flex gap-1 bg-white border border-gray-100 p-1 rounded-xl shadow-sm">
            {FILTER_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === opt.value ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Tag filter */}
          {tags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {tags.map(tag => (
                <button key={tag.id} onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}
                  className="text-xs px-3 py-1.5 rounded-xl font-medium transition-all border-2"
                  style={{
                    backgroundColor: tagFilter === tag.id ? tag.color : 'transparent',
                    color: tagFilter === tag.id ? '#fff' : tag.color,
                    borderColor: tag.color,
                  }}>
                  {tag.name}
                </button>
              ))}
            </div>
          )}

          <button onClick={() => setShowTagMgr(true)}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg hover:bg-white transition-colors border border-dashed border-gray-200">
            + Manage Tags
          </button>
        </div>
        )}

        {/* Calendar view */}
        {view === 'calendar' && (
          <CalendarView projects={projects} />
        )}

        {/* Projects grid */}
        {view === 'projects' && (loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 h-44 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">{statusFilter === 'all' && !tagFilter ? 'No projects yet.' : 'No projects match this filter.'}</p>
          </motion.div>
        ) : (
          <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {filtered.map((project, i) => (
                <ProjectCard key={project.id} project={project} index={i}
                  onEdit={p => setModal(p)} onDelete={setDeleteTarget} />
              ))}
            </AnimatePresence>
          </motion.div>
        ))}
      </main>

      {/* Modals */}
      <AnimatePresence>
        {modal && (
          <ProjectModal
            project={modal === 'create' ? null : modal}
            allTags={tags}
            onSave={handleSave}
            onClose={() => setModal(null)}
          />
        )}
        {showTagMgr && (
          <TagManager tags={tags} onTagsChange={setTags} onClose={() => setShowTagMgr(false)} />
        )}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Delete project?</h3>
              <p className="text-sm text-gray-500 mb-5">
                "<span className="font-medium text-gray-700">{deleteTarget.name}</span>" will be permanently removed.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTarget(null)}
                  className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button onClick={confirmDelete}
                  className="flex-1 bg-rose-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-rose-600 transition-colors">
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
