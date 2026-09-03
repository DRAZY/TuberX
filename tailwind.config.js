/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'tx-bg': '#1c1c1e',
        'tx-panel': '#232326',
        'tx-row': '#2a2a2d',
        'tx-border': '#3a3a3d',
        'tx-text': '#e5e5e7',
        'tx-muted': '#8e8e93',
        'tx-accent': '#e0393e',
        'tx-accent-hover': '#f04a4f',
      },
      fontFamily: { sans: ['Segoe UI', 'Roboto', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
