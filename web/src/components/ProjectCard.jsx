import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getStatus, getPriority, formatDeadline } from '../constants';

export default function ProjectCard({ project, onEdit, onDelete, index = 0 }) {
  const navigate = useNavigate();
  const status = getStatus(project.status);
  const priority = getPriority(project.priority);
  const deadline = project.deadline ? formatDeadline(project.deadline) : null;

  function handleCardClick(e) {
    if (e.target.closest('button')) return;
    navigate(`/projects/${project.id}`);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25, delay: index * 0.05, ease: 'easeOut' }}
      onClick={handleCardClick}
      className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden flex flex-col group"
    >
      {/* Color stripe */}
      <div className="h-1.5 w-full transition-all group-hover:h-2" style={{ backgroundColor: project.color }} />

      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${priority.dot}`} />
            <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">{project.name}</h3>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${status.bg} ${status.text}`}>
            {status.label}
          </span>
        </div>

        {/* Tags */}
        {project.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {project.tags.map(tag => (
              <span
                key={tag.id}
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: tag.color + '20', color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* Description */}
        {project.description && (
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{project.description}</p>
        )}

        {/* Progress */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Progress</span>
            <span className="text-xs font-semibold text-gray-600">{project.progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${project.progress}%` }}
              transition={{ duration: 0.6, delay: index * 0.05 + 0.1, ease: 'easeOut' }}
              style={{ backgroundColor: project.color }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-1">
          {deadline ? (
            <span className={`text-xs ${deadline.overdue ? 'text-rose-500 font-medium' : deadline.soon ? 'text-amber-500 font-medium' : 'text-gray-400'}`}>
              {deadline.overdue ? '⚠ ' : ''}{deadline.text}
            </span>
          ) : (
            <span className="text-xs text-gray-300">No deadline</span>
          )}

          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onEdit(project)}
              className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(project)}
              className="text-xs text-gray-400 hover:text-rose-500 px-2 py-1 rounded hover:bg-rose-50 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
