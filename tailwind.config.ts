// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        rb: {
          bg: '#15171D',          // base graphite — not near-black, has warmth
          panel: '#1C1F27',       // panel surface
          'panel-raised': '#232733',
          hairline: '#2C3140',
          text: '#E7E9EE',
          muted: '#8A90A3',
          faint: '#5B6072',
          amber: '#E8A33D',       // primary / active signal
          'amber-dim': '#3A311F',
          teal: '#4FB4A0',        // verified / consistent signature
          'teal-dim': '#1C302C',
          red: '#E2645C',         // high-entropy / danger / weak signature
          'red-dim': '#341F1F',
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        rb: '6px',
      },
    },
  },
  plugins: [],
};

export default config;
