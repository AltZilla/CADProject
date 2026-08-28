import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          400: '#94a3b8',
          100: '#f1f5f9',
        },
        orange: {
          500: '#f97316',
        },
        red: {
          500: '#ef4444',
        },
        green: {
          500: '#22c55e',
        },
        yellow: {
          300: '#fef08a',
        }
      },
    },
  },
  plugins: [],
} satisfies Config;
