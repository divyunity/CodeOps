/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'ops-bg':      '#f8fafc',   // near-white page background
        'ops-surface': '#ffffff',   // card / panel white
        'ops-border':  '#e2e8f0',   // slate-200 borders
        'ops-accent':  '#2563eb',   // blue-600 primary
        'ops-green':   '#16a34a',   // green-600
        'ops-red':     '#dc2626',   // red-600
        'ops-yellow':  '#d97706',   // amber-600
        'ops-muted':   '#64748b',   // slate-500 text
        'ops-text':    '#0f172a',   // slate-900 primary text
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink': 'blink 1s step-end infinite',
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-in': 'fadeIn 0.4s ease-out',
      },
      keyframes: {
        blink: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        slideIn: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
      },
    },
  },
  plugins: [],
};
