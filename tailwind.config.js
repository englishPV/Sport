/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      transitionTimingFunction: {
        // Courbe « sortie douce » utilisée partout pour un rendu naturel.
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
        'out-soft': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.94)' },
          to: { opacity: '1', transform: 'none' },
        },
        'icon-swap': {
          from: { opacity: '0', transform: 'rotate(-90deg) scale(0.5)' },
          to: { opacity: '1', transform: 'none' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-8px) scale(0.96)' },
          to: { opacity: '1', transform: 'none' },
        },
        'accordion-down': {
          from: { gridTemplateRows: '0fr', opacity: '0' },
          to: { gridTemplateRows: '1fr', opacity: '1' },
        },
        'sheet-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'pop-bump': {
          '0%': { transform: 'scale(1)' },
          '42%': { transform: 'scale(1.045)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 260ms ease-out both',
        'fade-up': 'fade-up 340ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-in': 'pop-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'icon-swap': 'icon-swap 280ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'toast-in': 'toast-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'accordion-down': 'accordion-down 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'sheet-up': 'sheet-up 380ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-bump': 'pop-bump 260ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}
