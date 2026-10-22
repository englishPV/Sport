import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0f172a',
        card: '#1e293b',
        elev: '#334155',
        accent: '#38bdf8',
        success: '#10b981',
        warn: '#f59e0b',
        danger: '#ef4444',
        ink: '#f1f5f9',
        muted: '#94a3b8',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      minHeight: {
        touch: '48px',
        validate: '64px',
      },
      minWidth: {
        touch: '48px',
      },
    },
  },
  plugins: [],
} satisfies Config
