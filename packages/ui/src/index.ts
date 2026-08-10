export const statusTones = {
  success: { foreground: '#4ade80', background: 'rgba(74,222,128,.12)' },
  warning: { foreground: '#facc15', background: 'rgba(250,204,21,.12)' },
  danger: { foreground: '#fb7185', background: 'rgba(251,113,133,.12)' },
  neutral: { foreground: '#a3a3a3', background: 'rgba(163,163,163,.12)' },
} as const;

export type StatusTone = keyof typeof statusTones;
