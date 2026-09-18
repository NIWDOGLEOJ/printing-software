/**
 * Billing Software Design Language — Shared Primitives
 * Direct replica of the NexusFlow / J MART design language from the billing system.
 */
import type { CSSProperties } from 'react';

/** Numerals, codes and eyebrows. Prose stays in Public Sans (set on body). */
export const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Figures. Tabular numerals so columns of figures align cleanly.
 */
export const NUM: CSSProperties = {
  fontFamily: MONO,
  fontVariantNumeric: 'tabular-nums',
};

/**
 * Section eyebrow — the signature device that structures panels.
 * 10px mono caps at 0.14em letter-spacing, sitting above a 1px rule.
 */
export const EYEBROW: CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: 'var(--ink3)',
};

/** Table / list column header. */
export const COL_HEAD: CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--ink3)',
};

/** Card / panel surface on the ruled ground. No shadows, 1px border. */
export const PANEL: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
};

/** Panel header strip: eyebrow or title on left, actions on right. */
export const PANEL_HEAD: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 14px',
  borderBottom: '1px solid var(--rule2)',
};

/** Inset control surface: inputs, selects, secondary buttons. */
export const FIELD: CSSProperties = {
  background: 'var(--sub)',
  border: '1px solid var(--border2)',
  borderRadius: 7,
  color: 'var(--ink)',
  outline: 'none',
};

/** Keycap badge. */
export const KBD: CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 700,
  border: '1px solid var(--border2)',
  borderBottomWidth: 2,
  borderRadius: 4,
  padding: '2px 6px',
  background: 'var(--sub)',
  color: 'var(--ink2)',
  whiteSpace: 'nowrap',
};

/** Keycap inside a filled button. */
export const KBD_ON_FILL: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 4,
  padding: '2px 6px',
  border: '1px solid color-mix(in srgb, currentColor 42%, transparent)',
  borderBottomWidth: 2,
};

/** Primary action button. */
export const BTN_PRIMARY: CSSProperties = {
  height: 42,
  border: 0,
  borderRadius: 8,
  background: 'var(--ink)',
  color: 'var(--panel)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

/** Accent action button (instrument blue). */
export const BTN_ACCENT: CSSProperties = {
  height: 42,
  border: 0,
  borderRadius: 8,
  background: 'var(--accent)',
  color: 'var(--primary-foreground)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

/** Secondary button on an inset ground. */
export const BTN_SECONDARY: CSSProperties = {
  height: 42,
  border: '1px solid var(--border2)',
  borderRadius: 8,
  background: 'var(--sub)',
  color: 'var(--ink)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

/** Status chip styles. */
export const CHIP = {
  ok: {
    background: 'var(--ok-soft)',
    border: '1px solid var(--ok-line)',
    color: 'var(--ok)',
  },
  warn: {
    background: 'var(--warn-soft)',
    border: '1px solid var(--warn-line)',
    color: 'var(--warn)',
  },
  danger: {
    background: 'var(--danger-soft)',
    border: '1px solid var(--danger-line)',
    color: 'var(--danger)',
  },
  accent: {
    background: 'var(--accent-soft)',
    border: '1px solid var(--accent-line)',
    color: 'var(--accent)',
  },
  neutral: {
    background: 'var(--rule)',
    border: '1px solid var(--border)',
    color: 'var(--ink2)',
  },
} satisfies Record<string, CSSProperties>;

/**
 * ₹ with Indian digit grouping and 2 decimal places.
 */
export function inr(n: number): string {
  return '₹' + Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Whole rupees for headers and counts. */
export function inrWhole(n: number): string {
  return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}

/** Ruled page background ground. */
export const PAGE_GROUND: CSSProperties = {
  backgroundColor: 'var(--bg)',
  backgroundImage: [
    'radial-gradient(1100px 640px at 80% -12%, var(--glow-a), transparent 62%)',
    'radial-gradient(880px 560px at 4% 108%, var(--glow-b), transparent 62%)',
    'repeating-linear-gradient(0deg, var(--grid2) 0 1px, transparent 1px 40px)',
    'repeating-linear-gradient(90deg, var(--grid2) 0 1px, transparent 1px 40px)',
    'repeating-linear-gradient(0deg, var(--grid1) 0 1px, transparent 1px 5px)',
    'repeating-linear-gradient(90deg, var(--grid1) 0 1px, transparent 1px 5px)',
  ].join(', '),
  backgroundAttachment: 'fixed',
};
