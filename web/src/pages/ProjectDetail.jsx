import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import ProjectModal from '../components/ProjectModal';
import { getStatus, getPriority, formatDeadline, COLORS } from '../constants';

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api.getProject(id)
      .then(setProject)
      .catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave(form) {
    const updated = await api.updateProject(id, form);
    setProject(updated);
    setEditing(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) return null;

  const status = getStatus(project.status);
  const priority = getPriority(project.priority);
  const deadline = project.deadline ? formatDeadline(project.deadline) : null;
  const colorLabel = COLORS.find(c => c.value === project.color)?.label || 'Custom';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-gray-600 transition-colors text-sm"
          >
            ← Back
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 truncate">{project.name}</h1>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors flex-shrink-0"
          >
            Edit
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Color bar + status row */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="h-2 w-full" style={{ backgroundColor: project.color }} />
          <div className="px-6 py-5 flex flex-wrap gap-3 items-center">
            <span className={`text-sm font-medium px-3 py-1 rounded-full ${status.bg} ${status.text}`}>
              {status.label}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-gray-600">
              <span className={`inline-block w-2 h-2 rounded-full ${priority.dot}`} />
              {priority.label} priority
            </span>
            {deadline && (
              <span className={`text-sm ${deadline.overdue ? 'text-rose-500 font-medium' : deadline.soon ? 'text-amber-500 font-medium' : 'text-gray-500'}`}>
                {deadline.overdue ? '⚠ Overdue · ' : '📅 '}{deadline.text}
              </span>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white rounded-xl border border-gray-100 px-6 py-5">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-medium text-gray-700">Progress</span>
            <span className="text-2xl font-bold" style={{ color: project.color }}>{project.progress}%</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${project.progress}%`, backgroundColor: project.color }}
            />
          </div>
        </div>

        {/* Description */}
        {project.description && (
          <div className="bg-white rounded-xl border border-gray-100 px-6 py-5">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Description</h2>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{project.description}</p>
          </div>
        )}

        {/* Notes */}
        {project.notes && (
          <div className="bg-white rounded-xl border border-gray-100 px-6 py-5">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notes</h2>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{project.notes}</p>
          </div>
        )}

        {/* Meta */}
        <div className="bg-white rounded-xl border border-gray-100 px-6 py-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Details</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Color</dt>
              <dd className="flex items-center gap-2 text-gray-700">
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: project.color }} />
                {colorLabel}
              </dd>
            </div>
            {project.deadline && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Deadline</dt>
                <dd className="text-gray-700">
                  {new Date(project.deadline + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-500">Created</dt>
              <dd className="text-gray-700">
                {new Date(project.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Last updated</dt>
              <dd className="text-gray-700">
                {new Date(project.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </dd>
            </div>
          </dl>
        </div>
      </main>

      {editing && (
        <ProjectModal
          project={project}
          onSave={handleSave}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
