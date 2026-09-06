const fs = require('fs');
const path = require('path');

const styles = ['regular', 'fill', 'bold', 'duotone', 'light', 'thin'];

styles.forEach(style => {
  const filePath = path.join('src', 'vendor', 'phosphor', style, 'style.css');
  let content = fs.readFileSync(filePath, 'utf8');
  const fontName = style === 'regular' ? 'Phosphor.woff2' : `Phosphor-${style.charAt(0).toUpperCase() + style.slice(1)}.woff2`;
  
  // Replace the src: ... block in @font-face with woff2 format
  content = content.replace(/src:\s*[\s\S]*?format\("svg"\);/, `src: url("./${fontName}") format("woff2");`);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Cleaned font-face in', filePath);
});

// Create unified src/vendor/phosphor/style.css
const unified = styles.map(s => `@import "./${s}/style.css";`).join('\n');
fs.writeFileSync(path.join('src', 'vendor', 'phosphor', 'style.css'), unified + '\n', 'utf8');
console.log('Created src/vendor/phosphor/style.css');
