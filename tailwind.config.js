/** @type {import('tailwindcss').Config} */
module.exports = {
  // Define where Tailwind should look for utility classes
  content: [
    "./index.html",
    "./admin.html",
    "./src/js/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        devo: {
          // Base Dark Theme Colors
          black: '#0a0a0a',       // Main application background
          dark: '#171717',        // Surface color (Cards, Modals)
          gray: '#262626',        // Borders, dividers, and disabled states
          grayHover: '#404040',   // Hover states for dark elements
          
          // Brand Colors
          orange: '#f97316',      // Primary brand color
          orangeHover: '#ea580c', // Darker orange for button hover states
          
          // Typography Colors
          text: '#f5f5f5',        // Primary text (Off-white for better readability)
          muted: '#a3a3a3',       // Secondary text, placeholders, and inactive icons
          
          // Semantic Colors (For Toasts, Modals, and Status indicators)
          success: '#10b981',     // Emerald 500 - Success states
          error: '#ef4444',       // Red 500 - Destructive actions/Errors
          warning: '#f59e0b',     // Amber 500 - Warnings/Alerts
          info: '#3b82f6'         // Blue 500 - Informational messages
        }
      },
      fontFamily: {
        // Primary Arabic Font
        sans: ['Tajawal', 'sans-serif'],
      },
      boxShadow: {
        // Custom elegant shadow for floating elements (Modals, Toasts)
        'devo-float': '0 10px 40px -10px rgba(0,0,0,0.8)',
      }
    },
    
  },
  plugins: [],
}