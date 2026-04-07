/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,html}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#00ff9d',
      }
    },
  },
  plugins: [],
}
