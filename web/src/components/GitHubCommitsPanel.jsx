import { useState, useEffect } from 'react';
import { api } from '../api';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function GitHubCommitsPanel({ projectId, repo, lastSyncedAt, onSynced }) {
  const [commits, setCommits]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [error, setError]       = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  async function loadCommits() {
    setLoading(true);
    try {
      const data = await api.getProjectCommits(projectId);
      setCommits(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCommits(); }, [projectId]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      await api.syncGitHubProject(projectId);
      await loadCommits();
      onSynced?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  const displayed = commits.slice(0, collapsed ? 0 : 10);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          <div>
            <span className="text-sm font-medium text-gray-700">{repo}</span>
            {lastSyncedAt && (
              <span className="text-xs text-gray-400 ml-2">synced {timeAgo(lastSyncedAt)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2.5 py-1 rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : '↻ Sync Now'}
          </button>
          <button onClick={() => setCollapsed(c => !c)}
            className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-1 rounded transition-colors">
            {collapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-xs text-rose-600 bg-rose-50">{error}</div>
      )}

      {/* Commit list */}
      {!collapsed && (
        <div className="divide-y divide-gray-50">
          {loading ? (
            <div className="px-4 py-4 text-xs text-gray-400 text-center">Loading commits…</div>
          ) : commits.length === 0 ? (
            <div className="px-4 py-4 text-xs text-gray-400 text-center">
              No commits yet — click Sync Now to fetch from GitHub.
            </div>
          ) : (
            displayed.map(commit => (
              <div key={commit.sha} className="px-4 py-3 flex items-start gap-3">
                {/* Author avatar */}
                <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 text-xs font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {(commit.author?.[0] || '?').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate" title={commit.message}>
                    {commit.message.length > 72 ? commit.message.slice(0, 72) + '…' : commit.message}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-400">{commit.author}</span>
                    <span className="text-xs text-gray-300">·</span>
                    <span className="text-xs text-gray-400">{timeAgo(commit.committed_at)}</span>
                    {commit.ai_summary && (
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
                        AI: {commit.ai_summary.length > 50 ? commit.ai_summary.slice(0, 50) + '…' : commit.ai_summary}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs font-mono text-gray-300 flex-shrink-0">{commit.sha.slice(0, 7)}</span>
              </div>
            ))
          )}
          {commits.length > 10 && (
            <div className="px-4 py-2 text-xs text-gray-400 text-center">
              Showing 10 of {commits.length} commits
            </div>
          )}
        </div>
      )}
    </div>
  );
}
