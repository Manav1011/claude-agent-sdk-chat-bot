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
          bg: '#0c0d10',
          surface: '#14151a',
          elevated: '#1c1e26',
          border: '#2a2d37',
          muted: '#343846',
        },
        txt: {
          main: '#f3f4f6',
          muted: '#9ca3af',
          subtle: '#6b7280',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'glow': '0 0 20px rgba(241, 105, 19, 0.15)',
        'card-glow': '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
      }
    },
  },
  plugins: [],
}
