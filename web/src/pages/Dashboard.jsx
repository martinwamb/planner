import { useState, useEffect } from 'react';
import { api } from '../api';
import ProjectCard from '../components/ProjectCard';
import ProjectModal from '../components/ProjectModal';
import { STATUSES } from '../constants';

const FILTER_OPTIONS = [{ value: 'all', label: 'All' }, ...STATUSES];

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'create' | project object
  const [filter, setFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const data = await api.getProjects();
      setProjects(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(form) {
    if (modal && modal.id) {
      const updated = await api.updateProject(modal.id, form);
      setProjects(ps => ps.map(p => p.id === updated.id ? updated : p));
    } else {
      const created = await api.createProject(form);
      setProjects(ps => [created, ...ps]);
    }
    setModal(null);
  }

  async function handleDelete(project) {
    setDeleteTarget(project);
  }

  async function confirmDelete() {
    await api.deleteProject(deleteTarget.id);
    setProjects(ps => ps.filter(p => p.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter);

  const stats = {
    total: projects.length,
    active: projects.filter(p => p.status === 'active').length,
    complete: projects.filter(p => p.status === 'complete').length,
    overdue: projects.filter(p => {
      if (!p.deadline || p.status === 'complete') return false;
      return new Date(p.deadline + 'T00:00:00') < new Date();
    }).length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Planner</h1>
            <p className="text-xs text-gray-400 mt-0.5">Project overview</p>
          </div>
          <button
            onClick={() => setModal('create')}
            className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            + New Project
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: stats.total, color: 'text-gray-900' },
            { label: 'Active', value: stats.active, color: 'text-blue-600' },
            { label: 'Complete', value: stats.complete, color: 'text-emerald-600' },
            { label: 'Overdue', value: stats.overdue, color: 'text-rose-500' },
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-100 px-5 py-4">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{stat.label}</p>
              <p className={`text-3xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filter === opt.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Projects grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 h-44 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">
              {filter === 'all' ? 'No projects yet. Create your first one.' : `No ${filter} projects.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                onEdit={p => setModal(p)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {/* Create/Edit modal */}
      {modal && (
        <ProjectModal
          project={modal === 'create' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Delete project?</h3>
            <p className="text-sm text-gray-500 mb-5">
              "<span className="font-medium text-gray-700">{deleteTarget.name}</span>" will be permanently removed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 bg-rose-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-rose-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
