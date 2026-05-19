/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0f1f3d',
        ink: '#172033',
        accent: '#7c3aed'
      }
    }
  },
  plugins: []
};
