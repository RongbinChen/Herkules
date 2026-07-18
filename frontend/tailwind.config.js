/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Herkules brand accent — corporate steel blue (matches herkulesgroup.com).
        // Neutrals use Tailwind slate.
        brand: {
          50: '#f0f6fb',
          100: '#dbeaf6',
          200: '#bcd7ee',
          300: '#8fbbe1',
          400: '#5b97cf',
          500: '#3178ba',
          600: '#1c6cb0', // primary accent
          700: '#175a94',
          800: '#164b78',
          900: '#163f64',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
        'card-hover': '0 8px 24px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
}
