import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';

export default function GitHubSettings({ onClose }) {
  const [hasToken, setHasToken]   = useState(null);
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving]       = useState(false);
  const [removing, setRemoving]   = useState(false);
  const [error, setError]         = useState(null);
  const [success, setSuccess]     = useState(false);

  useEffect(() => {
    api.getGitHubPat()
      .then(d => setHasToken(d.hasToken))
      .catch(() => setHasToken(false));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.saveGitHubPat(tokenInput.trim());
      setHasToken(true);
      setTokenInput('');
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setError(null);
    try {
      await api.deleteGitHubPat();
      setHasToken(false);
      setSuccess(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gray-900 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">GitHub Integration</h2>
                <p className="text-xs text-gray-400">Connect your repos to auto-update tasks</p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Status */}
            <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium ${
              hasToken === null ? 'bg-gray-50 text-gray-400'
                : hasToken ? 'bg-green-50 text-green-700 border border-green-100'
                : 'bg-gray-50 text-gray-500'
            }`}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                hasToken === null ? 'bg-gray-300'
                  : hasToken ? 'bg-green-500'
                  : 'bg-gray-300'
              }`} />
              {hasToken === null ? 'Checking...'
                : hasToken ? 'GitHub PAT connected'
                : 'No GitHub PAT configured'}
            </div>

            {/* Token input */}
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {hasToken ? 'Replace Personal Access Token' : 'Personal Access Token'}
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={e => { setTokenInput(e.target.value); setError(null); setSuccess(false); }}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 font-mono"
                />
              </div>

              <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-xs text-blue-700 space-y-1">
                <p className="font-semibold">Required token scopes:</p>
                <ul className="list-disc list-inside space-y-0.5 text-blue-600">
                  <li><code className="font-mono">repo</code> — for private repositories</li>
                  <li><code className="font-mono">public_repo</code> — for public repositories only</li>
                </ul>
                <p className="mt-1">
                  Generate at{' '}
                  <a href="https://github.com/settings/tokens/new?scopes=repo" target="_blank" rel="noreferrer"
                    className="underline hover:text-blue-800">
                    github.com/settings/tokens
                  </a>
                </p>
              </div>

              {error && (
                <p className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-xl">{error}</p>
              )}
              {success && (
                <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-xl">Token saved successfully.</p>
              )}

              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={saving || !tokenInput.trim()}
                  className="flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-gray-700 transition-colors disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save Token'}
                </button>
                {hasToken && (
                  <button type="button" onClick={handleRemove} disabled={removing}
                    className="px-4 py-2.5 text-sm text-rose-500 hover:text-rose-700 border border-rose-100 hover:bg-rose-50 rounded-xl transition-colors disabled:opacity-50">
                    {removing ? '…' : 'Remove'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
