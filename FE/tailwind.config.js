/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#f16913',
          hover: '#ff7b25',
          glow: 'rgba(241, 105, 19, 0.15)',
          border: 'rgba(241, 105, 19, 0.3)',
        },
        dark: {
          bg: 'rgb(var(--color-dark-bg) / <alpha-value>)',
          surface: 'rgb(var(--color-dark-surface) / <alpha-value>)',
          elevated: 'rgb(var(--color-dark-elevated) / <alpha-value>)',
          border: 'rgb(var(--color-dark-border) / <alpha-value>)',
          muted: 'rgb(var(--color-dark-muted) / <alpha-value>)',
        },
        txt: {
          main: 'rgb(var(--color-txt-main) / <alpha-value>)',
          muted: 'rgb(var(--color-txt-muted) / <alpha-value>)',
          subtle: 'rgb(var(--color-txt-subtle) / <alpha-value>)',
        }
      },
      fontFamily: {
        // ponytail: IBM Plex instead of Inter/JetBrains — one family pair, technical DNA,
        // distinctive g/a and slash-0. Don't swap without a reason.
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow': '0 0 20px rgba(241, 105, 19, 0.15)',
        'card-glow': '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'sheet-up': 'sheetUp 320ms cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fadeIn 200ms ease-out',
      },
      keyframes: {
        sheetUp: {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
