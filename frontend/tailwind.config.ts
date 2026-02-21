import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Chainlink-aligned palette
        cl: {
          blue:     '#375BD2',
          'blue-l': '#4a6cf7',
          'blue-xl':'#7898ff',
          navy:     '#0a0e1a',
          'navy-l': '#0f1629',
          'navy-m': '#131d36',
          card:     'rgba(255,255,255,0.04)',
          border:   'rgba(255,255,255,0.08)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Mono', 'monospace'],
      },
      backgroundImage: {
        'grid-pattern': `linear-gradient(rgba(55,91,210,0.06) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(55,91,210,0.06) 1px, transparent 1px)`,
        'hero-glow': 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(55,91,210,0.35) 0%, transparent 70%)',
        'card-shine': 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 50%)',
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
      boxShadow: {
        'glow-sm':  '0 0 12px rgba(55,91,210,0.25)',
        'glow':     '0 0 28px rgba(55,91,210,0.35)',
        'glow-lg':  '0 0 60px rgba(55,91,210,0.4)',
        'card':     '0 1px 1px rgba(0,0,0,0.3), 0 4px 20px rgba(0,0,0,0.35)',
      },
      animation: {
        'pulse-slow':  'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'float':       'float 6s ease-in-out infinite',
        'shimmer':     'shimmer 1.8s linear infinite',
        'fade-up':     'fadeUp 0.4s ease forwards',
        'spin-slow':   'spin 8s linear infinite',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%':     { transform: 'translateY(-12px)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
