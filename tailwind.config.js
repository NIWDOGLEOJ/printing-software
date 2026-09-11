/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Public Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        sub: 'var(--sub)',
        rule: 'var(--rule)',
        rule2: 'var(--rule2)',
        border: 'var(--border)',
        border2: 'var(--border2)',
        ink: 'var(--ink)',
        ink2: 'var(--ink2)',
        ink3: 'var(--ink3)',
        ink4: 'var(--ink4)',
        accent: {
          DEFAULT: 'var(--accent)',
          hi: 'var(--accent-hi)',
          soft: 'var(--accent-soft)',
          line: 'var(--accent-line)',
        },
        ok: {
          DEFAULT: 'var(--ok)',
          soft: 'var(--ok-soft)',
          line: 'var(--ok-line)',
        },
        warn: {
          DEFAULT: 'var(--warn)',
          hi: 'var(--warn-hi)',
          soft: 'var(--warn-soft)',
          line: 'var(--warn-line)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          strong: 'var(--danger-strong)',
          soft: 'var(--danger-soft)',
          line: 'var(--danger-line)',
        },
      }
    },
  },
  plugins: [],
}

