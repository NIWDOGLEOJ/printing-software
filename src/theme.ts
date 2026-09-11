import { useState, useEffect } from 'react';

export type ThemeMode = 'dark' | 'light';

export function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem('theme') || localStorage.getItem('nexusflow_theme');
    if (saved === 'light') return 'light';
    return 'dark'; // Billing software defaults to dark instrument panel
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: ThemeMode) {
  try {
    localStorage.setItem('theme', theme);
    localStorage.setItem('nexusflow_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: theme }));
  } catch {}
}

export function useTheme(): [ThemeMode, (next?: ThemeMode) => void] {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

  useEffect(() => {
    applyTheme(theme);

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<ThemeMode>;
      if (customEvent.detail) {
        setTheme(customEvent.detail);
      }
    };
    window.addEventListener('theme-changed', handler);
    return () => window.removeEventListener('theme-changed', handler);
  }, [theme]);

  const toggleTheme = (next?: ThemeMode) => {
    const newTheme = next || (theme === 'dark' ? 'light' : 'dark');
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  return [theme, toggleTheme];
}
