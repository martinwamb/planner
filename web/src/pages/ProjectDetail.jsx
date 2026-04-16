import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';
import ProjectModal from '../components/ProjectModal';
import TaskModal from '../components/TaskModal';
import { getStatus, getPriority, formatDeadline } from '../constants';

const COLUMNS = [
  { id: 'todo',        label: 'To Do',       ring: 'border-gray-200',   badge: 'bg-gray-100 text-gray-600'     },
  { id: 'in-progress', label: 'In Progress', ring: 'border-blue-200',   badge: 'bg-blue-50 text-blue-700'     },
  { id: 'review',      label: 'Review',      ring: 'border-amber-200',  badge: 'bg-amber-50 text-amber-700'   },
  { id: 'done',        label: 'Done',        ring: 'border-emerald-200',badge: 'bg-emerald-50 text-emerald-700'},
];

function TaskCard({ task, onEdit, onDelete, onStatusChange, onChecklistToggle }) {
  const checkDone  = task.checklist?.filter(c => c.checked).length || 0;
  const checkTotal = task.checklist?.length || 0;
  const hasBullets = task.context?.length || task.purpose?.length;
  const [expanded, setExpanded] = useState(false);

  function handleDragStart(e) {
    e.dataTransfer.setData('taskId', task.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
      draggable onDragStart={handleDragStart}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-medium text-gray-900 leading-tight flex-1">{task.title}</p>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={() => onEdit(task)} className="text-xs text-gray-400 hover:text-gray-700 px-1">✎</button>
          <button onClick={() => onDelete(task)} className="text-xs text-gray-400 hover:text-rose-500 px-1">✕</button>
        </div>
      </div>

      {hasBullets && <p className="text-xs text-indigo-400 mb-2">Structured</p>}

      {checkTotal > 0 && (
        <div className="space-y-1.5 mb-2">
          <div className="flex items-center justify-between">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden mr-2">
              <div className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${checkTotal > 0 ? (checkDone / checkTotal) * 100 : 0}%` }} />
            </div>
            <span className="text-xs text-gray-400 flex-shrink-0">{checkDone}/{checkTotal}</span>
          </div>

          {/* Inline checklist items */}
          <button onClick={() => setExpanded(e => !e)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            {expanded ? '▲ Hide checklist' : '▼ Show checklist'}
          </button>
          <AnimatePresence>
            {expanded && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-1.5 pt-1">
                {task.checklist.map(item => (
                  <label key={item.id} className="flex items-start gap-2 cursor-pointer group/item">
                    <input type="checkbox" checked={!!item.checked}
                      onChange={() => onChecklistToggle(item.id, !item.checked, task.id)}
                      className="mt-0.5 rounded accent-emerald-500 flex-shrink-0" />
                    <span className={`text-xs leading-relaxed ${item.checked ? 'line-through text-gray-300' : 'text-gray-600'}`}>
                      {item.text}
                    </span>
                  </label>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Quick move */}
      <div className="flex gap-1 pt-2 border-t border-gray-50 flex-wrap">
        {COLUMNS.filter(c => c.id !== task.status).map(col => (
          <button key={col.id} onClick={() => onStatusChange(task.id, col.id)}
            className={`text-xs px-2 py-0.5 rounded-md ${col.badge} transition-opacity hover:opacity-80`}>
            → {col.label}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject]     = useState(null);
  const [allProjects, setAllProjects] = useState([]);
  const [tasks, setTasks]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editingProject, setEditingProject] = useState(false);
  const [taskModal, setTaskModal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [dragOverCol, setDragOverCol]   = useState(null);
  const [sidebarOpen, setSidebarOpen]   = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getProject(id), api.getTasks(id), api.getProjects()])
      .then(([p, t, all]) => { setProject(p); setTasks(t); setAllProjects(all); })
      .catch(() => navigate('/dashboard'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSaveProject(form) {
    const updated = await api.updateProject(id, form);
    setProject(updated);
    setEditingProject(false);
  }

  async function handleSaveTask(form) {
    if (taskModal?.id) {
      const updated = await api.updateTask(taskModal.id, form);
      setTasks(ts => ts.map(t => t.id === updated.id ? updated : t));
    } else {
      const created = await api.createTask(id, form);
      setTasks(ts => [...ts, created]);
    }
    setTaskModal(null);
  }

  async function handleStatusChange(taskId, newStatus) {
    await api.moveTask(taskId, newStatus);
    setTasks(ts => ts.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
  }

  async function handleChecklistToggle(itemId, checked, taskId) {
    const result = await api.toggleChecklist(itemId, checked);
    // Update checklist item in state
    setTasks(ts => ts.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        status: result.task_status ?? t.status,
        checklist: t.checklist.map(c => c.id === itemId ? { ...c, checked } : c),
      };
    }));
    // Update project progress
    if (result.project_progress !== undefined) {
      setProject(p => ({ ...p, progress: result.project_progress }));
    }
  }

  async function handleDeleteTask() {
    await api.deleteTask(deleteTarget.id);
    setTasks(ts => ts.filter(t => t.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  function handleDragOver(e, colId) { e.preventDefault(); setDragOverCol(colId); }
  function handleDrop(e, colId) {
    e.preventDefault();
    const taskId = Number(e.dataTransfer.getData('taskId'));
    setDragOverCol(null);
    const task = tasks.find(t => t.id === taskId);
    if (task && task.status !== colId) handleStatusChange(taskId, colId);
  }

  if (loading) return (
    <div className="min-h-screen bg-[#f9f8f6] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
    </div>
  );
  if (!project) return null;

  const status   = getStatus(project.status);
  const priority = getPriority(project.priority);
  const deadline = project.deadline ? formatDeadline(project.deadline) : null;
  const tasksByCol = Object.fromEntries(COLUMNS.map(c => [c.id, tasks.filter(t => t.status === c.id)]));

  return (
    <div className="h-screen bg-[#f9f8f6] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 flex-shrink-0 z-20">
        <div className="px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')}
            className="text-gray-400 hover:text-gray-600 transition-colors text-sm flex-shrink-0">
            ← Dashboard
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
            <h1 className="text-base font-bold text-gray-900 truncate">{project.name}</h1>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${status.bg} ${status.text}`}>
              {status.label}
            </span>
          </div>
          <button onClick={() => setEditingProject(true)}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0">
            Edit
          </button>
          <button onClick={() => setTaskModal('new')}
            className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-gray-700 transition-colors flex-shrink-0">
            + Add Task
          </button>
          <button onClick={() => setSidebarOpen(o => !o)}
            className="text-gray-400 hover:text-gray-600 px-2 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm flex-shrink-0"
            title="Toggle project list">
            ⊞
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-6 space-y-5">
            {/* Project info bar */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="h-1.5 w-full" style={{ backgroundColor: project.color }} />
              <div className="px-6 py-4 flex flex-wrap gap-6 items-center">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${priority.dot}`} />
                  <span className="text-sm text-gray-600">{priority.label} priority</span>
                </div>
                {deadline && (
                  <span className={`text-sm ${deadline.overdue ? 'text-rose-500 font-medium' : deadline.soon ? 'text-amber-500' : 'text-gray-500'}`}>
                    {deadline.overdue ? '⚠ Overdue · ' : '📅 '}{deadline.text}
                  </span>
                )}
                <div className="flex items-center gap-3 flex-1 min-w-48">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full" layout
                      animate={{ width: `${project.progress}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                      style={{ backgroundColor: project.color }} />
                  </div>
                  <span className="text-sm font-semibold text-gray-700 w-10 text-right">{project.progress}%</span>
                </div>
                {project.tags?.length > 0 && (
                  <div className="flex gap-1.5">
                    {project.tags.map(tag => (
                      <span key={tag.id} className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: tag.color + '20', color: tag.color }}>
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {project.description && (
                <div className="px-6 pb-4">
                  <p className="text-sm text-gray-500 leading-relaxed">{project.description}</p>
                </div>
              )}
            </div>

            {/* Kanban board */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-6">
              {COLUMNS.map(col => (
                <div key={col.id}
                  onDragOver={e => handleDragOver(e, col.id)}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={e => handleDrop(e, col.id)}
                  className={`rounded-xl border-2 transition-all min-h-[220px] p-3 space-y-3 ${
                    dragOverCol === col.id
                      ? 'border-indigo-300 bg-indigo-50/60'
                      : `${col.ring} bg-gray-50/60`
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${col.badge}`}>{col.label}</span>
                      <span className="text-xs text-gray-400">{tasksByCol[col.id]?.length || 0}</span>
                    </div>
                    <button onClick={() => setTaskModal('new')} className="text-gray-300 hover:text-gray-600 text-sm transition-colors">+</button>
                  </div>
                  <AnimatePresence>
                    {tasksByCol[col.id]?.map(task => (
                      <TaskCard key={task.id} task={task}
                        onEdit={t => setTaskModal(t)}
                        onDelete={t => setDeleteTarget(t)}
                        onStatusChange={handleStatusChange}
                        onChecklistToggle={handleChecklistToggle}
                      />
                    ))}
                  </AnimatePresence>
                  {!tasksByCol[col.id]?.length && (
                    <p className="text-xs text-gray-300 text-center pt-6">Drop tasks here</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Project sidebar */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 240, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-l border-gray-100 bg-white overflow-y-auto flex-shrink-0 min-h-0"
            >
              <div className="p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">All Projects</p>
                <div className="space-y-1">
                  {allProjects.map(p => {
                    const s = getStatus(p.status);
                    const isCurrent = String(p.id) === String(id);
                    return (
                      <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl transition-all group ${
                          isCurrent ? 'bg-gray-900 text-white' : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                          <span className={`text-xs font-medium truncate ${isCurrent ? 'text-white' : 'text-gray-800'}`}>
                            {p.name}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pl-4">
                          <span className={`text-xs ${isCurrent ? 'text-gray-300' : 'text-gray-400'}`}>
                            {p.progress}%
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${isCurrent ? 'bg-white/10 text-white' : `${s.bg} ${s.text}`}`}>
                            {s.label}
                          </span>
                        </div>
                        <div className="mt-1.5 pl-4">
                          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${p.progress}%`, backgroundColor: isCurrent ? '#ffffff60' : p.color }} />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {editingProject && (
          <ProjectModal project={project} onSave={handleSaveProject} onClose={() => setEditingProject(false)} />
        )}
        {taskModal && (
          <TaskModal task={taskModal === 'new' ? null : taskModal} projectId={id}
            onSave={handleSaveTask} onClose={() => setTaskModal(null)} />
        )}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Delete task?</h3>
              <p className="text-sm text-gray-500 mb-5">
                "<span className="font-medium text-gray-700">{deleteTarget.title}</span>" will be permanently removed.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTarget(null)}
                  className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-medium hover:bg-gray-50">Cancel</button>
                <button onClick={handleDeleteTask}
                  className="flex-1 bg-rose-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-rose-600">Delete</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
