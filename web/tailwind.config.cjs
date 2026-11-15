const path = require('node:path');
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [path.join(__dirname, 'index.html'), path.join(__dirname, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#eef3fa', 100: '#d6e1f1', 600: '#2b4f86', 700: '#1f3a68', 800: '#182e53', 900: '#12223d' },
        teal: { 50: '#e8f6f6', 100: '#c7eaea', 500: '#1c8c8c', 600: '#167373', 700: '#115c5c' },
      },
      fontFamily: { sans: ['"Be Vietnam Pro"', '"Segoe UI"', 'system-ui', 'Arial', 'sans-serif'] },
    },
  },
  plugins: [],
};
