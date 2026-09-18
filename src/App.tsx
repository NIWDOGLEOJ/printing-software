import React, { useState, useEffect } from 'react';
import { CustomerPortal } from './components/CustomerPortal.js';
import { AdminDashboard } from './components/AdminDashboard.js';
import { LoginPage } from './components/LoginPage.js';
import { fetchCurrentUser, logout } from './api.js';
import { AuthUser } from './types.js';

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

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    fetchCurrentUser()
      .then((user) => {
        setCurrentUser(user);
      })
      .catch(() => {})
      .finally(() => {
        setIsCheckingAuth(false);
      });
  }, []);

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

  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
  };

  return (
    <div className="min-h-screen">
      {view === 'admin' ? (
        isCheckingAuth ? (
          <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] font-mono text-xs text-[var(--ink3)]">
            <div className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Verifying session...
            </div>
          </div>
        ) : currentUser ? (
          <AdminDashboard
            currentUser={currentUser}
            onLogout={handleLogout}
            onSwitchToCustomerView={() => navigateTo('upload')}
          />
        ) : (
          <LoginPage
            onLoginSuccess={(user) => setCurrentUser(user)}
            onBackToCustomerView={() => navigateTo('upload')}
          />
        )
      ) : (
        <div className="relative">
          {/* Subtle admin entry trigger in customer view */}
          <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-20">
            <button
              onClick={() => navigateTo('admin')}
              className="text-[11px] font-bold text-[var(--ink3)] hover:text-[var(--ink)] bg-[var(--panel)]/90 hover:bg-[var(--panel)] px-2.5 py-1 rounded-lg border border-[var(--border)] shadow-xs transition cursor-pointer font-mono"
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
