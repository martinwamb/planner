import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const features = [
  { icon: '◈', title: 'Projects',     desc: 'Organised by priority, status, and colour coding'       },
  { icon: '◇', title: 'Kanban Board', desc: 'Visual task boards with drag-and-drop columns'           },
  { icon: '◉', title: 'Tags',         desc: 'Categorise across any dimension you define'              },
  { icon: '✦', title: 'AI Insights',  desc: 'Weekly digests, priority suggestions, and task writing'  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#f9f8f6] flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 max-w-5xl mx-auto w-full">
        <span className="text-lg font-bold text-gray-900 tracking-tight">Planner</span>
        <Link to="/login"
          className="text-sm text-gray-500 hover:text-gray-900 font-medium transition-colors">
          Sign in →
        </Link>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center py-16">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="max-w-2xl"
        >
          <div className="inline-flex items-center gap-2 text-xs font-medium text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            Personal · Private · AI-powered
          </div>

          <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 leading-tight tracking-tight mb-5">
            Keep your projects<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-500">
              clear and moving.
            </span>
          </h1>

          <p className="text-lg text-gray-500 leading-relaxed mb-10 max-w-lg mx-auto">
            A minimal workspace for organising everything you're working on.
            Track progress, manage tasks in Kanban boards, and let AI keep you
            focused on what matters most.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/login?mode=register"
              className="bg-gray-900 text-white px-7 py-3 rounded-xl font-medium text-sm hover:bg-gray-700 transition-colors shadow-sm">
              Get started free
            </Link>
            <Link to="/login"
              className="bg-white text-gray-700 border border-gray-200 px-7 py-3 rounded-xl font-medium text-sm hover:bg-gray-50 transition-colors">
              Sign in
            </Link>
          </div>
        </motion.div>

        {/* Feature grid */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-20 max-w-4xl w-full"
        >
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.08 }}
              className="bg-white rounded-2xl border border-gray-100 p-5 text-left"
            >
              <div className="text-2xl text-indigo-500 mb-3">{f.icon}</div>
              <p className="text-sm font-semibold text-gray-900 mb-1">{f.title}</p>
              <p className="text-xs text-gray-400 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Preview hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mt-16 flex items-center gap-6"
        >
          {['Planning', 'Active', 'On Hold', 'Complete'].map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ['#94a3b8','#3b82f6','#f59e0b','#10b981'][i] }} />
              <span className="text-xs text-gray-400">{s}</span>
            </div>
          ))}
        </motion.div>
      </main>

      <footer className="text-center py-6 text-xs text-gray-300">
        planner.wambugumartin.com
      </footer>
    </div>
  );
}
