import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import InvitePage from './pages/InvitePage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen bg-[#f9f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen bg-[#f9f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
    </div>
  );
  return (
    <Routes>
      <Route path="/"               element={user ? <Navigate to="/dashboard" replace /> : <Landing />} />
      <Route path="/login"          element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/dashboard"      element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/projects/:id"   element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
      <Route path="/invite/:token"  element={<InvitePage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
