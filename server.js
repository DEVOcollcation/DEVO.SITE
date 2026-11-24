const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const ROOT_DIR = __dirname;

// Prevent serving server, config, migration, or dot files
const BLOCKED_PREFIXES = ['/node_modules', '/supabase', '/scripts', '/docs'];
const BLOCKED_EXTENSIONS = /\.(sql|mjs|md|lock)$/i;
const BLOCKED_FILES = new Set([
  '/server.js',
  '/package.json',
  '/package-lock.json',
  '/tailwind.config.js',
  '/vercel.json',
]);

app.use((req, res, next) => {
  let normalizedPath = '/';
  try {
    normalizedPath = decodeURIComponent(req.path || '/');
  } catch {
    return res.status(400).send('Bad Request');
  }

  if (
    normalizedPath.includes('/.') ||
    BLOCKED_FILES.has(normalizedPath) ||
    BLOCKED_EXTENSIONS.test(normalizedPath) ||
    BLOCKED_PREFIXES.some(
      (prefix) => normalizedPath === prefix || normalizedPath.startsWith(prefix + '/')
    )
  ) {
    return res.status(404).send('Not found');
  }
  next();
});

// Preserve caching and PWA headers from vercel.json
app.use((req, res, next) => {
  const p = req.path;
  if (p === '/sw.js') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Service-Worker-Allowed', '/');
  } else if (p === '/version.json' || p === '/' || p.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  } else if (/^\/manifest.*\.json$/.test(p) || p.startsWith('/src/assets/icons/')) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate, max-age=0');
  } else if (p.startsWith('/src/js/') || p.startsWith('/src/css/')) {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }
  next();
});

app.use(
  express.static(ROOT_DIR, {
    extensions: ['html'],
    dotfiles: 'ignore',
    index: 'index.html',
  })
);

app.use((req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`DEVO server running at http://${HOST}:${PORT}`);
});
