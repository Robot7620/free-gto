/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        poker: {
          felt: '#0a5f38',
          chip: {
            red: '#dc2626',
            blue: '#2563eb',
            green: '#16a34a',
            black: '#171717',
          },
        },
      },
    },
  },
  plugins: [],
}
