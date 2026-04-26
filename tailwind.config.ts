import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14130f',
        sand: '#f8f2e7',
        ember: '#db5b32',
        moss: '#5c7c5a',
        ocean: '#265c78'
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Plus Jakarta Sans"', 'sans-serif']
      },
      boxShadow: {
        pet: '0 16px 50px rgba(20, 19, 15, 0.18)'
      }
    }
  },
  plugins: []
} satisfies Config;
