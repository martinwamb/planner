import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';
import { COLORS } from '../constants';

export default function TagManager({ tags, onTagsChange, onClose }) {
  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setError('');
    try {
      const tag = await api.createTag({ name: newName.trim(), color: newColor });
      onTagsChange([...tags, tag]);
      setNewName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tagId) {
    await api.deleteTag(tagId);
    onTagsChange(tags.filter(t => t.id !== tagId));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Manage Tags</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">✕</button>
        </div>

        {/* Existing tags */}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {tags.length === 0 && <p className="text-sm text-gray-400">No tags yet.</p>}
          <AnimatePresence>
            {tags.map(tag => (
              <motion.div
                key={tag.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="flex items-center justify-between"
              >
                <span
                  className="text-sm font-medium px-3 py-1 rounded-full"
                  style={{ backgroundColor: tag.color + '20', color: tag.color }}
                >
                  {tag.name}
                </span>
                <button
                  onClick={() => handleDelete(tag.id)}
                  className="text-xs text-gray-400 hover:text-rose-500 transition-colors"
                >
                  Remove
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Create new */}
        <form onSubmit={handleCreate} className="space-y-3 border-t border-gray-100 pt-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">New Tag</p>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Tag name (e.g. Web, App, Client)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <div className="flex gap-1.5 flex-wrap">
            {COLORS.map(c => (
              <button
                key={c.value}
                type="button"
                onClick={() => setNewColor(c.value)}
                className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: c.value,
                  outline: newColor === c.value ? `3px solid ${c.value}` : '3px solid transparent',
                  outlineOffset: '2px',
                }}
              />
            ))}
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <button
            type="submit"
            disabled={saving || !newName.trim()}
            className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add Tag'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
