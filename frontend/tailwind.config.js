/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        accent: {
          cyan: '#22d3ee',
          teal: '#2dd4bf',
          emerald: '#34d399',
          amber: '#fbbf24',
          rose: '#fb7185',
          violet: '#a78bfa',
        },
        dark: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#9babc0',
          500: '#64748b',
          600: '#475569',
          700: '#2a3650',
          750: '#222f43',
          800: '#1e2a3d',
          850: '#181c27',
          900: '#141820',
          950: '#0f1219',
        },
        yes: {
          DEFAULT: '#22c55e',
          light: '#4ade80',
          dark: '#16a34a',
          muted: 'rgba(34, 197, 94, 0.15)',
          border: 'rgba(34, 197, 94, 0.3)',
        },
        no: {
          DEFAULT: '#ef4444',
          light: '#f87171',
          dark: '#dc2626',
          muted: 'rgba(239, 68, 68, 0.15)',
          border: 'rgba(239, 68, 68, 0.3)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      boxShadow: {
        'glow-sm': '0 0 15px -3px rgba(59, 130, 246, 0.2)',
        'glow': '0 0 25px -5px rgba(59, 130, 246, 0.3)',
        'glow-lg': '0 0 40px -8px rgba(59, 130, 246, 0.35)',
        'glow-yes': '0 0 20px -5px rgba(34, 197, 94, 0.25)',
        'glow-no': '0 0 20px -5px rgba(239, 68, 68, 0.25)',
        'card': '0 4px 24px -4px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04)',
        'card-hover': '0 8px 40px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(59, 130, 246, 0.15)',
        'elevated': '0 20px 60px -15px rgba(0, 0, 0, 0.8)',
        'inner-glow': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.05)',
        'sm': '0px 3px 6px 0px rgba(0, 0, 0, 0.5), 0px 1px 3px -1px rgba(0, 0, 0, 0.4)',
        'md': '0px 6px 12px 0px rgba(0, 0, 0, 0.7), 0px 2px 6px -2px rgba(0, 0, 0, 0.6)',
        'lg': '0px 10px 20px 0px rgba(0, 0, 0, 0.8), 0px 4px 8px -2px rgba(0, 0, 0, 0.7)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'hero-gradient': 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(34, 211, 238, 0.04) 50%, rgba(59, 130, 246, 0.02) 100%)',
        'card-gradient': 'linear-gradient(180deg, rgba(30, 42, 61, 0.5) 0%, rgba(20, 24, 32, 0.7) 100%)',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
        '4xl': '1.5rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'fade-in-up': 'fadeInUp 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'pulse-soft': 'pulseSoft 2.5s ease-in-out infinite',
        'shimmer': 'shimmer 1.5s infinite',
        'gradient': 'gradient 6s ease infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        gradient: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      transitionDuration: {
        '250': '250ms',
        '350': '350ms',
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '100': '25rem',
        '112': '28rem',
        '128': '32rem',
      },
      screens: {
        'xs': '475px',
      },
    },
  },
  plugins: [],
}
