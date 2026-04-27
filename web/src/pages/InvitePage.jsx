import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function InvitePage() {
  const { token }   = useParams();
  const { user }    = useAuth();
  const navigate    = useNavigate();
  const [invite, setInvite]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState(false);

  useEffect(() => {
    api.getInvite(token)
      .then(setInvite)
      .catch(() => setError('This invite link is invalid or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAccept() {
    if (!user) { navigate(`/login?next=/invite/${token}`); return; }
    setAccepting(true);
    try {
      const result = await api.acceptInvite(token);
      setDone(true);
      setTimeout(() => navigate('/dashboard'), 1800);
    } catch (err) {
      setError(err.message || 'Failed to accept invite.');
    } finally { setAccepting(false); }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#f9f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f9f8f6] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="bg-gray-900 px-8 py-6">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-1">Planner</p>
          <h1 className="text-white text-xl font-bold">You're invited!</h1>
        </div>

        <div className="px-8 py-6 space-y-5">
          {error && (
            <div className="text-sm text-rose-500 bg-rose-50 border border-rose-100 rounded-xl p-3">{error}</div>
          )}

          {done && (
            <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
              ✓ Joined! Redirecting to dashboard…
            </div>
          )}

          {!error && !done && invite && (
            <>
              <p className="text-sm text-gray-600 leading-relaxed">
                <span className="font-semibold text-gray-900">{invite.inviter_name}</span> has invited you to collaborate on
              </p>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: invite.workspace_color }} />
                <span className="font-semibold text-gray-900">{invite.workspace_name}</span>
              </div>

              {invite.accepted ? (
                <p className="text-sm text-gray-400 text-center">This invite has already been accepted.</p>
              ) : !user ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 text-center">Sign in or create an account to accept</p>
                  <button onClick={() => navigate(`/login?next=/invite/${token}`)}
                    className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
                    Sign in to accept
                  </button>
                </div>
              ) : (
                <button onClick={handleAccept} disabled={accepting}
                  className="w-full bg-gray-900 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-700 transition-colors disabled:opacity-50">
                  {accepting ? 'Joining…' : `Accept & join ${invite.workspace_name}`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
