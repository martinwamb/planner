import { useState, useEffect } from 'react';
import { api } from '../api';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 2)    return 'just now';
  if (mins < 60)   return `${mins} min ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days === 1)  return 'yesterday';
  return `${days} days ago`;
}

function groupByDate(entries) {
  const groups = {};
  for (const e of entries) {
    const d = new Date(e.created_at + 'Z');
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    let label;
    if (d.toDateString() === today.toDateString()) label = 'Today';
    else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday';
    else label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  }
  return groups;
}

export default function ActivityLog() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    api.getActivityLog()
      .then(setEntries)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-400">
        Loading activity…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-rose-500">
        {error}
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl mb-3">📋</div>
        <p className="text-sm font-medium text-gray-500">No activity yet</p>
        <p className="text-xs text-gray-400 mt-1">Activity will appear here as you use the app and GitHub syncs run.</p>
      </div>
    );
  }

  const groups = groupByDate(entries);

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-2">
      {Object.entries(groups).map(([date, items]) => (
        <div key={date}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{date}</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>
          <div className="space-y-2">
            {items.map(entry => (
              <div key={entry.id}
                className="flex items-start gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3 hover:border-gray-200 transition-colors">
                {/* Project color dot */}
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5"
                  style={{ backgroundColor: entry.project_color || '#9ca3af' }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 leading-snug">{entry.message}</p>
                  {entry.project_name && (
                    <p className="text-xs text-gray-400 mt-0.5">{entry.project_name}</p>
                  )}
                </div>
                <span className="text-xs text-gray-300 flex-shrink-0 mt-0.5 whitespace-nowrap">
                  {timeAgo(entry.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
