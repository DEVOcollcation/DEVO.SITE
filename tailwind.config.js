/** @type {import('tailwindcss').Config} */

const withOpacity = (variableName, fallback) => {
  return ({ opacityValue }) => {
    if (opacityValue !== undefined) {
      return `color-mix(in srgb, var(${variableName}, ${fallback}) calc(${opacityValue} * 100%), transparent)`;
    }
    return `var(${variableName}, ${fallback})`;
  };
};

module.exports = {
  // Define where Tailwind should look for utility classes
  content: [
    "./index.html",
    "./admin.html",
    "./auth.html",
    "./src/js/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        devo: {
          // Base Dark Theme Colors (driven by CSS custom properties with fallbacks)
          black: withOpacity('--devo-black', '#0a0a0a'),
          dark: withOpacity('--devo-dark', '#171717'),
          gray: withOpacity('--devo-gray', '#262626'),
          grayHover: withOpacity('--devo-gray-hover', '#404040'),
          
          // Brand Colors
          orange: withOpacity('--devo-orange', '#f97316'),
          orangeHover: withOpacity('--devo-orange-hover', '#ea580c'),
          
          // Typography Colors
          text: withOpacity('--devo-text', '#f5f5f5'),
          muted: withOpacity('--devo-muted', '#a3a3a3'),
          
          // Semantic Colors (For Toasts, Modals, and Status indicators)
          success: withOpacity('--devo-success', '#10b981'),
          error: withOpacity('--devo-error', '#ef4444'),
          warning: withOpacity('--devo-warning', '#f59e0b'),
          info: withOpacity('--devo-info', '#3b82f6')
        }
      },
      fontFamily: {
        // Primary Arabic Font
        sans: ['Tajawal', 'sans-serif'],
      },
      boxShadow: {
        // Custom elegant shadow for floating elements (Modals, Toasts)
        'devo-float': 'var(--shadow-devo-float, 0 10px 40px -10px rgba(0,0,0,0.8))',
      }
    },
  },
  plugins: [],
}