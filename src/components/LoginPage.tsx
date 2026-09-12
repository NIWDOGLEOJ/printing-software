import React, { useState, useEffect } from 'react';
import { login, fetchShopDetails } from '../api.js';
import { AuthUser, ShopDetails } from '../types.js';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser) => void;
  onBackToCustomerView?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginSuccess,
  onBackToCustomerView,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [shop, setShop] = useState<ShopDetails | null>(null);

  useEffect(() => {
    fetchShopDetails()
      .then(setShop)
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMessage('Please enter both username and password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const res = await login(username.trim(), password);
      if (res.success && res.user) {
        onLoginSuccess(res.user);
      } else {
        setErrorMessage('Invalid credentials. Please try again.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Shop Logo & Title */}
        <div className="text-center">
          {shop?.logoUrl ? (
            <img
              src={shop.logoUrl}
              alt={shop.shopName || 'Shop Logo'}
              className="mx-auto h-16 w-auto object-contain mb-3 drop-shadow-sm"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold text-2xl shadow-md shadow-emerald-600/20 mb-3">
              🖨️
            </div>
          )}

          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            {shop?.shopName || 'J MART'}
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Quick Print Station • Operator Portal
          </p>
        </div>

        {/* Login Card */}
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
          <div className="bg-white py-8 px-6 sm:px-10 shadow-xl shadow-slate-200/50 rounded-2xl border border-slate-200">
            <div className="mb-6">
              <h3 className="text-lg font-bold text-slate-900">Sign in with Billing Account</h3>
              <p className="text-xs text-slate-500 mt-1">
                Use your active POS billing operator credentials (Owner, Co-owner, or Employee).
              </p>
            </div>

            {errorMessage && (
              <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium flex items-center gap-2">
                <span className="text-base leading-none">⚠️</span>
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  autoCapitalize="none"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin or employee name"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                  disabled={isLoading}
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition disabled:opacity-50 cursor-pointer"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Authenticating...
                    </span>
                  ) : (
                    'Sign In to Print Station'
                  )}
                </button>
              </div>
            </form>

            <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-400">
                Database:{' '}
                <span className="font-semibold text-slate-600">
                  {shop?.source === 'pos_db' ? 'Synced (retail.db)' : 'Standalone'}
                </span>
              </span>

              {onBackToCustomerView && (
                <button
                  type="button"
                  onClick={onBackToCustomerView}
                  className="text-emerald-600 hover:text-emerald-700 font-semibold transition"
                >
                  ← Customer View
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
