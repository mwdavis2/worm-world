/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: true,
    // The theme used when the OS is in dark mode and the user hasn't picked
    // one (daisyUI's built-in prefers-color-scheme rule). Keep in sync with
    // OS_DARK_THEME in src/components/Layout/Layout.tsx.
    darkTheme: 'night',
  },
  variants: {
    extend: {
      display: ['group-hover'],
    },
  },
};
