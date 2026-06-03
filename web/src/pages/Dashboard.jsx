import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import ProjectCard from '../components/ProjectCard';
import ProjectModal from '../components/ProjectModal';
import TagManager from '../components/TagManager';
import CalendarView from '../components/CalendarView';
import GitHubSettings from '../components/GitHubSettings';
import { STATUSES } from '../constants';

const FILTER_OPTIONS = [{ value: 'all', label: 'All' }, ...STATUSES];

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [projects, setProjects]         = useState([]);
  const [tags, setTags]                 = useState([]);
  const [loading, setLoading]           = useState(true);
  const [modal, setModal]               = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter]       = useState(null);
  const [showTagMgr, setShowTagMgr]     = useState(false);
  const [aiPanel, setAiPanel]           = useState(null);
  const [aiLoading, setAiLoading]       = useState(false);
  const [view, setView]                 = useState('projects');
  const [taskStats, setTaskStats]       = useState(null);
  const [workspaces, setWorkspaces]     = useState([]);
  const [activeWs, setActiveWs]         = useState(null); // null = all
  const [showWsModal, setShowWsModal]   = useState(false);
  const [wsForm, setWsForm]             = useState({ name: '', color: '#6366f1' });
  const [showMembers, setShowMembers]   = useState(false);
  const [members, setMembers]           = useState({ members: [], invites: [] });
  const [inviteEmail, setInviteEmail]   = useState('');
  const [inviting, setInviting]         = useState(false);
  const [rewards, setRewards]           = useState(null);
  const [showRewards, setShowRewards]   = useState(false);
  const [todayPlan, setTodayPlan]       = useState(null);
  const [planLoading, setPlanLoading]   = useState(false);
  const [snoozed, setSnoozed]           = useState({});
  const [showGitHub, setShowGitHub]     = useState(false);
  const [importing, setImporting]       = useState(false);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const snoozedTask = params.get('snoozed');
    if (snoozedTask && snoozedTask !== 'invalid' && snoozedTask !== 'expired' && snoozedTask !== 'notfound') {
      setAiPanel({ snooze_notice: decodeURIComponent(snoozedTask) });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    api.getRewards().then(setRewards).catch(() => {});
    Promise.all([api.getWorkspaces(), api.getTags(), api.getTaskStats()])
      .then(([ws, t, ts]) => {
        setWorkspaces(ws);
        setTags(t);
        setTaskStats(ts);
        // Default to first workspace
        const first = ws[0] || null;
        setActiveWs(first);
        return api.getProjects(first?.id);
      })
      .then(p => setProjects(p))
      .finally(() => setLoading(false));
  }, []);

  async function switchWorkspace(ws) {
    setActiveWs(ws);
    setStatusFilter('all');
    setTagFilter(null);
    setLoading(true);
    const p = await api.getProjects(ws?.id);
    setProjects(p);
    const ts = await api.getTaskStats();
    setTaskStats(ts);
    setLoading(false);
  }

  async function createWorkspace() {
    if (!wsForm.name.trim()) return;
    const ws = await api.createWorkspace(wsForm);
    setWorkspaces(prev => [...prev, ws]);
    setShowWsModal(false);
    setWsForm({ name: '', color: '#6366f1' });
    switchWorkspace(ws);
  }

  async function loadMembers(ws) {
    const data = await api.getWorkspaceMembers(ws.id);
    setMembers(data);
    setShowMembers(true);
  }

  async function sendInvite() {
    if (!inviteEmail.trim() || !activeWs) return;
    setInviting(true);
    try {
      await api.inviteMember(activeWs.id, inviteEmail.trim());
      setInviteEmail('');
      await loadMembers(activeWs);
    } catch (err) {
      alert(err.message || 'Invite failed');
    } finally { setInviting(false); }
  }

  async function removeMember(userId) {
    await api.removeMember(activeWs.id, userId);
    await loadMembers(activeWs);
  }

  async function handleSave(form) {
    if (modal?.id) {
      const updated = await api.updateProject(modal.id, form);
      setProjects(ps => ps.map(p => p.id === updated.id ? updated : p));
    } else {
      const created = await api.createProject({ ...form, workspace_id: activeWs?.id });
      setProjects(ps => [created, ...ps]);
    }
    setModal(null);
  }

  async function handleGitHubImport() {
    setImporting(true);
    setImportResult(null);
    try {
      const r = await api.scanAndImportRepos();
      setImportResult(r);
      const p = await api.getProjects(activeWs?.id);
      setProjects(p);
    } catch (err) {
      setImportResult({ error: err.message });
    } finally {
      setImporting(false);
    }
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

  async function handleTodayPlan() {
    if (todayPlan) { setTodayPlan(null); setSnoozed({}); return; }
    setPlanLoading(true);
    try {
      const today = new Date().toLocaleDateString('en-CA');
      const plan  = await api.getDailyPlan(today);
      setTodayPlan(plan);
    } catch { setTodayPlan({ error: "Could not load today's plan." }); }
    finally { setPlanLoading(false); }
  }

  async function handleSnooze(taskId, days) {
    try {
      const result = await api.snoozeTask(taskId, days);
      setSnoozed(prev => ({ ...prev, [taskId]: result.due_date }));
    } catch (err) {
      alert(err.message || 'Could not reschedule task');
    }
  }

  // Filtering
  let filtered = statusFilter === 'all' ? projects : projects.filter(p => p.status === statusFilter);
  if (tagFilter) filtered = filtered.filter(p => p.tags?.some(t => t.id === tagFilter));

  const PROJECT_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16','#f97316'];
  const projectColorMap = {};
  projects.forEach((p, i) => { projectColorMap[p.id] = PROJECT_COLORS[i % PROJECT_COLORS.length]; });
  const ts = taskStats || { todo: 0, 'in-progress': 0, review: 0, done: 0, byProject: {} };

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-3 sm:px-6">
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
              {/* Points + streak pill */}
              {rewards && (
                <button onClick={() => setShowRewards(true)}
                  className="hidden sm:flex items-center gap-1.5 bg-amber-50 border border-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1.5 rounded-xl hover:bg-amber-100 transition-colors">
                  <span>⭐</span>
                  <span>{rewards.total_points?.toLocaleString() || 0} pts</span>
                  {rewards.current_streak > 0 && (
                    <span className="ml-1 text-orange-500">🔥 {rewards.current_streak}</span>
                  )}
                </button>
              )}
              <button onClick={handleAIPriorities} disabled={aiLoading}
                className="text-sm text-indigo-600 hover:text-indigo-800 px-3 py-2 rounded-lg hover:bg-indigo-50 transition-colors font-medium disabled:opacity-50">
                {aiLoading ? '…' : '✦ AI Insights'}
              </button>
              <button onClick={handleTodayPlan} disabled={planLoading}
                className={`text-sm px-3 py-2 rounded-lg transition-colors hidden sm:block font-medium ${
                  todayPlan ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}>
                {planLoading ? '…' : "Today's plan"}
              </button>
              <button onClick={handleSendDigest} disabled={aiLoading}
                className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors hidden sm:block">
                Weekly digest
              </button>
              <button onClick={() => setModal('create')}
                className="bg-gray-900 text-white text-sm font-medium px-3 sm:px-4 py-2 rounded-xl hover:bg-gray-700 transition-colors">
                <span className="hidden sm:inline">+ New Project</span>
                <span className="sm:hidden">+</span>
              </button>
              <button onClick={handleGitHubImport} disabled={importing}
                title="Scan all GitHub repos and create/update projects"
                className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors disabled:opacity-50">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
                {importing ? 'Importing…' : 'Import repos'}
              </button>
              <button onClick={() => setShowGitHub(true)} title="GitHub PAT settings"
                className="text-gray-400 hover:text-gray-700 px-2 py-2 rounded-lg hover:bg-gray-100 transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </button>
              <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded transition-colors">
                Sign out
              </button>
            </div>
          </div>
          {/* Workspace + view tabs row */}
          <div className="flex items-center justify-between border-t border-gray-100">
            {/* Workspace tabs */}
            <div className="flex items-center gap-1 overflow-x-auto">
              {workspaces.map(ws => (
                <button key={ws.id} onClick={() => switchWorkspace(ws)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                    activeWs?.id === ws.id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ws.color }} />
                  {ws.name}
                  {ws.member_count > 1 && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{ws.member_count}</span>
                  )}
                </button>
              ))}
              <button onClick={() => setShowWsModal(true)}
                className="px-3 py-2.5 text-sm text-gray-300 hover:text-gray-500 border-b-2 border-transparent transition-colors">+ Workspace</button>
            </div>
            {/* View tabs */}
            <div className="flex gap-0 flex-shrink-0">
              {[['projects', 'Projects'], ['calendar', 'Calendar']].map(([v, label]) => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
                    view === v ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}>
                  {label}
                </button>
              ))}
              {activeWs?.role === 'owner' && (
                <button onClick={() => loadMembers(activeWs)}
                  className="px-3 py-2.5 text-sm text-gray-400 hover:text-gray-600 border-b-2 border-transparent transition-colors" title="Manage members">
                  👥
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'To Do',       key: 'todo',        color: 'text-gray-700' },
            { label: 'In Progress', key: 'in-progress', color: 'text-blue-600' },
            { label: 'Review',      key: 'review',      color: 'text-amber-500' },
            { label: 'Done',        key: 'done',        color: 'text-emerald-600' },
          ].map((stat, i) => (
            <motion.div key={stat.label}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
              className="bg-white rounded-xl border border-gray-100 px-5 py-4">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{stat.label}</p>
              <p className={`text-3xl font-bold mt-1 ${stat.color}`}>{ts[stat.key] ?? 0}</p>
              {ts.byProject[stat.key]?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {ts.byProject[stat.key].map(proj => {
                    const shortName = proj.projectName.split('|').pop().trim().slice(0, 10);
                    const color = projectColorMap[proj.projectId] || '#6b7280';
                    return (
                      <span key={proj.projectId} title={`${proj.projectName}: ${proj.count} task${proj.count !== 1 ? 's' : ''}`}
                        className="text-xs px-1.5 py-0.5 rounded font-medium leading-tight"
                        style={{ backgroundColor: color + '18', color }}>
                        {shortName} · {proj.count}
                      </span>
                    );
                  })}
                </div>
              )}
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
                {aiPanel.snooze_notice && <p className="text-sm text-indigo-600">"{aiPanel.snooze_notice}" rescheduled — a different task will appear tomorrow.</p>}
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

        {/* Today's Plan Panel */}
        <AnimatePresence>
          {todayPlan && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Today's Focus</h3>
                  <div className="flex items-center gap-2">
                    <button onClick={handleSendDailyDigest} disabled={aiLoading}
                      className="text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50">
                      {aiLoading ? '…' : 'Send email'}
                    </button>
                    <button onClick={() => { setTodayPlan(null); setSnoozed({}); }}
                      className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                  </div>
                </div>
                {todayPlan.error && <p className="text-sm text-rose-500">{todayPlan.error}</p>}
                {todayPlan.summary && <p className="text-sm text-gray-500 mb-4 italic">{todayPlan.summary}</p>}
                <div className="space-y-3">
                  {(todayPlan.blocks || []).map(block => {
                    const isSnoozed = snoozed[block.task_id];
                    return (
                      <div key={block.task_id || block.task}
                        className={`border border-gray-100 rounded-xl overflow-hidden transition-opacity ${isSnoozed ? 'opacity-40' : ''}`}>
                        <div className="px-4 py-3 bg-gray-50 flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={
                                block.label === 'Top Priority' ? { background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3' } :
                                block.label === 'Important'    ? { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' } :
                                                                  { background: '#f9fafb', color: '#6b7280', border: '1px solid #e5e7eb' }
                              }>{block.label}</span>
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: block.color }} />
                              <span className="text-xs text-gray-400 truncate">{block.project}</span>
                            </div>
                            <p className="text-sm font-semibold text-gray-900">{block.task}</p>
                            {block.items?.[0] && <p className="text-xs text-gray-500 mt-0.5">· {block.items[0]}</p>}
                          </div>
                          {isSnoozed ? (
                            <span className="text-xs text-gray-400 flex-shrink-0 mt-1 whitespace-nowrap">→ {isSnoozed}</span>
                          ) : block.task_id ? (
                            <div className="flex gap-1 flex-shrink-0">
                              {[[3, '+3d'], [7, '+1w'], [14, '+2w']].map(([days, label]) => (
                                <button key={days} onClick={() => handleSnooze(block.task_id, days)}
                                  className="text-xs text-gray-400 hover:text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 transition-colors">
                                  {label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        {block.reason && (
                          <div className="px-4 py-2 border-t border-gray-50">
                            <p className="text-xs text-gray-400 italic">{block.reason}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
        {showGitHub && (
          <GitHubSettings onClose={() => setShowGitHub(false)} />
        )}
        {importResult && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm">
            <div className={`rounded-2xl shadow-lg px-5 py-4 text-sm flex items-start gap-3 ${importResult.error ? 'bg-rose-50 border border-rose-100 text-rose-700' : 'bg-white border border-gray-100 text-gray-800'}`}>
              <span className="text-lg flex-shrink-0">{importResult.error ? '⚠' : '✓'}</span>
              <div className="flex-1 min-w-0">
                {importResult.error ? (
                  <p>{importResult.error}</p>
                ) : (
                  <>
                    <p className="font-semibold">GitHub import complete</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {importResult.created} project{importResult.created !== 1 ? 's' : ''} created ·{' '}
                      {importResult.linked} linked ·{' '}
                      {importResult.tasks_created} tasks generated
                    </p>
                  </>
                )}
              </div>
              <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">✕</button>
            </div>
          </div>
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
                  className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
                <button onClick={confirmDelete}
                  className="flex-1 bg-rose-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-rose-600 transition-colors">Delete</button>
              </div>
            </motion.div>
          </div>
        )}

        {/* New Workspace modal */}
        {showWsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4">
              <h3 className="text-base font-semibold text-gray-900">New Workspace</h3>
              <input type="text" value={wsForm.name} onChange={e => setWsForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Workspace name" autoFocus
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-500">Colour</label>
                <input type="color" value={wsForm.color} onChange={e => setWsForm(f => ({ ...f, color: e.target.value }))}
                  className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowWsModal(false)}
                  className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-medium hover:bg-gray-50">Cancel</button>
                <button onClick={createWorkspace} disabled={!wsForm.name.trim()}
                  className="flex-1 bg-gray-900 text-white rounded-xl py-2 text-sm font-medium hover:bg-gray-700 disabled:opacity-50">Create</button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Members panel */}
        {showMembers && activeWs && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{activeWs.name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Members &amp; Invitations</p>
                </div>
                <button onClick={() => { setShowMembers(false); setInviteEmail(''); }}
                  className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
              <div className="px-6 py-5 space-y-5">
                {/* Invite */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Invite by email</p>
                  <div className="flex gap-2">
                    <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendInvite()}
                      placeholder="colleague@example.com"
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    <button onClick={sendInvite} disabled={inviting || !inviteEmail.trim()}
                      className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {inviting ? '…' : 'Invite'}
                    </button>
                  </div>
                </div>
                {/* Current members */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Members</p>
                  <div className="space-y-2">
                    {members.members.map(m => (
                      <div key={m.id} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-600 flex-shrink-0">
                          {(m.name || m.email)[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{m.name || m.email}</p>
                          <p className="text-xs text-gray-400 truncate">{m.email}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${m.role === 'owner' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>{m.role}</span>
                        {m.role !== 'owner' && m.id !== user?.id && (
                          <button onClick={() => removeMember(m.id)} className="text-xs text-gray-300 hover:text-rose-400 transition-colors">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Pending invites */}
                {members.invites?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Pending invites</p>
                    <div className="space-y-1.5">
                      {members.invites.map(inv => (
                        <div key={inv.id} className="flex items-center gap-2 text-sm text-gray-500">
                          <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                          <span className="flex-1 truncate">{inv.email}</span>
                          <span className="text-xs text-gray-300">awaiting</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
        {/* Rewards / Badges panel */}
        {showRewards && rewards && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
                <h3 className="text-base font-semibold text-gray-900">Your Progress</h3>
                <button onClick={() => setShowRewards(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-gray-100">
                {[
                  { icon: '⭐', label: 'Points',         value: (rewards.total_points || 0).toLocaleString() },
                  { icon: '✅', label: 'Tasks done',     value: rewards.tasks_completed || 0 },
                  { icon: '🔥', label: 'Day streak',     value: rewards.current_streak  || 0 },
                ].map(s => (
                  <div key={s.label} className="text-center bg-gray-50 rounded-xl py-3">
                    <p className="text-xl mb-0.5">{s.icon}</p>
                    <p className="text-lg font-bold text-gray-900">{s.value}</p>
                    <p className="text-xs text-gray-400">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Checklist + project stats */}
              <div className="flex gap-6 px-6 py-3 border-b border-gray-100 text-sm text-gray-500">
                <span>☑ <strong className="text-gray-700">{rewards.checklist_done || 0}</strong> checklist items</span>
                <span>🏆 <strong className="text-gray-700">{rewards.projects_completed || 0}</strong> projects completed</span>
                {(rewards.longest_streak || 0) > (rewards.current_streak || 0) && (
                  <span>📈 Best streak: <strong className="text-gray-700">{rewards.longest_streak}</strong> days</span>
                )}
              </div>

              {/* Badges grid */}
              <div className="px-6 py-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Badges</p>
                <div className="grid grid-cols-2 gap-2">
                  {(rewards.badges || []).map(badge => (
                    <div key={badge.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        badge.earned
                          ? 'border-amber-200 bg-amber-50'
                          : 'border-gray-100 bg-gray-50 opacity-50'
                      }`}>
                      <span className="text-2xl flex-shrink-0">{badge.emoji}</span>
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold truncate ${badge.earned ? 'text-gray-900' : 'text-gray-400'}`}>
                          {badge.name}
                        </p>
                        <p className="text-xs text-gray-400 leading-tight">{badge.desc}</p>
                        {badge.earned && badge.earned_at && (
                          <p className="text-xs text-amber-500 mt-0.5">
                            {new Date(badge.earned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
