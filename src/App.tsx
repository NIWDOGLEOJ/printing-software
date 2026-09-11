import React, { useState, useEffect } from 'react';
import { CustomerPortal } from './components/CustomerPortal.js';
import { AdminDashboard } from './components/AdminDashboard.js';

export const App: React.FC = () => {
  // Determine current view from pathname or query param
  const [view, setView] = useState<'upload' | 'admin'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase();
      const params = new URLSearchParams(window.location.search);
      if (path.startsWith('/admin') || params.get('view') === 'admin') {
        return 'admin';
      }
    }
    return 'upload';
  });

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      const params = new URLSearchParams(window.location.search);
      if (path.startsWith('/admin') || params.get('view') === 'admin') {
        setView('admin');
      } else {
        setView('upload');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (newView: 'upload' | 'admin') => {
    setView(newView);
    const newPath = newView === 'admin' ? '/admin' : '/';
    window.history.pushState({}, '', newPath);
  };

  return (
    <div className="min-h-screen">
      {view === 'admin' ? (
        <AdminDashboard onSwitchToCustomerView={() => navigateTo('upload')} />
      ) : (
        <div className="relative">
          {/* Subtle admin entry trigger in customer view */}
          <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-20">
            <button
              onClick={() => navigateTo('admin')}
              className="text-[11px] font-bold text-slate-400 hover:text-slate-800 bg-white/80 hover:bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-xs transition"
            >
              Shop PC Login
            </button>
          </div>
          <CustomerPortal />
        </div>
      )}
    </div>
  );
};

export default App;
