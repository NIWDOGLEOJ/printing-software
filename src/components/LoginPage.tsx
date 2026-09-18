import React, { useState, useEffect, useRef } from 'react';
import { login, fetchShopDetails } from '../api.js';
import { AuthUser, ShopDetails } from '../types.js';
import {
  MONO,
  NUM,
  EYEBROW,
  PANEL,
  FIELD,
  BTN_PRIMARY,
  KBD_ON_FILL,
} from '../lib/design-system.js';
import { useTheme } from '../theme.js';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser) => void;
  onBackToCustomerView?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginSuccess,
  onBackToCustomerView,
}) => {
  const [theme, toggleTheme] = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [shop, setShop] = useState<ShopDetails | null>(null);

  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchShopDetails()
      .then(setShop)
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setErrorMessage('Enter a username to continue.');
      return;
    }
    if (!password) {
      setErrorMessage('Enter your password.');
      passwordRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const res = await login(username.trim(), password);
      if (res.success && res.user) {
        onLoginSuccess(res.user);
      } else {
        setErrorMessage('Invalid credentials. Please verify your username and password.');
        setPassword('');
        passwordRef.current?.focus();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Login failed. Please check network connection.');
      setPassword('');
      passwordRef.current?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] flex flex-col justify-between font-sans dc-ground">
      {/* Top Header Bar — Exactly matching Billing Terminal */}
      <header className="flex items-center justify-between px-6 h-[58px] border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--sub)] border border-[var(--border2)] flex items-center justify-center text-base overflow-hidden shrink-0">
            {shop?.logoUrl ? (
              <img
                src={shop.logoUrl}
                alt={shop.shopName || 'Shop Logo'}
                className="w-full h-full object-contain p-1"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              '🖨️'
            )}
          </div>
          <span className="text-[16px] font-black tracking-[-0.02em] text-[var(--ink)]">
            {shop?.shopName || 'J MART'}
          </span>
          <span style={EYEBROW} className="hidden sm:inline">
            Print Terminal Sign-In
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[var(--ok)] animate-pulse" />
            <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink3)' }}>
              Online
            </span>
          </div>

          <button
            type="button"
            onClick={() => toggleTheme()}
            className="h-[30px] px-2.5 rounded-[7px] font-mono text-[11px] font-bold tracking-[0.06em] uppercase cursor-pointer transition-colors"
            style={{ ...FIELD, color: 'var(--ink2)' }}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      {/* Centered Single Login Box */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div
          className="w-full max-w-[420px]"
          style={{
            ...PANEL,
            borderRadius: 12,
            padding: '32px 28px',
            boxShadow: '0 8px 30px var(--paper-shadow)',
          }}
        >
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-[var(--sub)] border border-[var(--border2)] flex items-center justify-center text-2xl overflow-hidden shrink-0">
                {shop?.logoUrl ? (
                  <img
                    src={shop.logoUrl}
                    alt={shop.shopName || 'Logo'}
                    className="w-full h-full object-contain p-1"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  '🖨️'
                )}
              </div>
              <div>
                <div style={EYEBROW}>Counter Terminal</div>
                <div className="text-[18px] font-black tracking-tight text-[var(--ink)]">
                  {shop?.shopName || 'J MART'}
                </div>
              </div>
            </div>

            <h1 className="text-[22px] font-extrabold tracking-[-0.03em] mb-1 text-[var(--ink)]">
              Sign in with Billing Account
            </h1>
            <p className="text-[13px] leading-relaxed text-[var(--ink2)]">
              Enter your POS operator credentials (Owner, Co-owner, or Employee).
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Username Input */}
            <div>
              <label
                htmlFor="username"
                className="block text-[12px] font-semibold text-[var(--ink2)] mb-1.5"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                autoCapitalize="none"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setErrorMessage('');
                }}
                placeholder="Cashier or Operator username"
                disabled={isLoading}
                className="w-full text-[15px] px-3.5 transition-colors focus:border-[var(--accent)]"
                style={{ ...FIELD, height: 46 }}
              />
            </div>

            {/* Password Input */}
            <div>
              <label
                htmlFor="password"
                className="block text-[12px] font-semibold text-[var(--ink2)] mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  ref={passwordRef}
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMessage('');
                  }}
                  placeholder="••••••••"
                  disabled={isLoading}
                  className="w-full text-[15px] pl-3.5 pr-16 transition-colors focus:border-[var(--accent)]"
                  style={{ ...FIELD, ...NUM, height: 46 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1.5 top-1.5 h-[34px] px-2.5 rounded-[5px] text-[11px] font-semibold cursor-pointer transition-colors"
                  style={{ ...FIELD, color: 'var(--ink2)' }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div
                className="p-3 rounded-[8px] text-[12px] font-semibold animate-in fade-in duration-150"
                style={{
                  background: 'var(--danger-soft)',
                  border: '1px solid var(--danger-line)',
                  color: 'var(--danger)',
                }}
              >
                {errorMessage}
              </div>
            )}

            {/* Primary Sign In Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 h-[48px] rounded-[8px] text-[14px] font-bold cursor-pointer flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
              style={{
                ...BTN_PRIMARY,
                height: 48,
              }}
            >
              <span>{isLoading ? 'Opening station…' : 'Sign in to Print Station'}</span>
              <span style={KBD_ON_FILL}>Enter</span>
            </button>
          </form>

          {/* Footer inside card */}
          <div
            className="flex items-center justify-between text-[11px] mt-6 pt-4 border-t"
            style={{ borderColor: 'var(--rule)', color: 'var(--ink3)' }}
          >
            <span>
              Database:{' '}
              <span className="font-semibold text-[var(--ink2)]" style={{ fontFamily: MONO }}>
                {shop?.source === 'pos_db' ? 'Synced (retail.db)' : 'Standalone'}
              </span>
            </span>

            {onBackToCustomerView && (
              <button
                type="button"
                onClick={onBackToCustomerView}
                className="font-semibold cursor-pointer hover:underline transition"
                style={{ color: 'var(--accent)' }}
              >
                ← Customer View
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Subtle brand label at the bottom of the screen */}
      <footer className="py-2.5 text-center shrink-0">
        <span
          className="font-mono text-[10px] tracking-wider select-none pointer-events-none uppercase font-bold"
          style={{ color: 'var(--ink4)', opacity: 0.4 }}
        >
          {shop?.shopName || 'J MART'} • QUICK PRINT STATION
        </span>
      </footer>
    </div>
  );
};
