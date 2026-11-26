import http from 'node:http';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT || 4173);

function resolvePath(urlPath) {
  const cleanPath = urlPath === '/' ? '/index.html' : urlPath;
  return path.join(distDir, cleanPath.replace(/^\/+/, ''));
}

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: 'GET',
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, body });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const filePath = resolvePath(req.url || '/');

  try {
    await access(filePath);
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

try {
  const home = await request('/');
  if (home.statusCode !== 200) {
    throw new Error(`Expected / to return 200, got ${home.statusCode}`);
  }
  if (!home.body.includes('<div id="app"></div>')) {
    throw new Error('Home page is missing the app root');
  }
  if (!home.body.includes('app.js')) {
    throw new Error('Home page is missing the app module script');
  }

  const appJs = await request('/src/ui/app.js');
  if (appJs.statusCode !== 200) {
    throw new Error(`Expected /src/ui/app.js to return 200, got ${appJs.statusCode}`);
  }
  if (!appJs.body.includes('SessionManager')) {
    throw new Error('App bundle does not contain the expected boot logic');
  }

  // ── SEO / brand metadata (needed for NLarchive portfolio integration) ──
  const requiredHead = [
    '<meta name="description"',
    '<link rel="canonical" href="https://nlarchive.github.io/web-p2p-message/">',
    '<meta property="og:image" content="https://nlarchive.github.io/web-p2p-message/src/ui/og-image.png">',
    'https://www.nlarchive.com/proyectos/',
  ];
  for (const needle of requiredHead) {
    if (!home.body.includes(needle)) throw new Error(`Home page is missing SEO/brand metadata: ${needle}`);
  }
  const ldMatch = home.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!ldMatch) throw new Error('Home page is missing JSON-LD structured data');
  const ld = JSON.parse(ldMatch[1]);
  if (ld['@type'] !== 'SoftwareApplication' || ld.publisher?.name !== 'NLarchive SpA') {
    throw new Error('JSON-LD must describe a SoftwareApplication published by NLarchive SpA');
  }

  const ogImage = await request('/src/ui/og-image.png');
  if (ogImage.statusCode !== 200) throw new Error(`Expected og-image.png to return 200, got ${ogImage.statusCode}`);

  if (!appJs.body.includes('Built by NLarchive')) throw new Error('App footer is missing the NLarchive brand link');
  if (appJs.body.includes('/blob/main/')) throw new Error('App links to a non-existent "main" branch; use master');
  if (!appJs.body.includes('isFramed()')) throw new Error('App is missing the clickjacking (frame) guard');

  const styles = await request('/src/ui/styles.css');
  if (styles.statusCode !== 200) {
    throw new Error(`Expected /src/ui/styles.css to return 200, got ${styles.statusCode}`);
  }
  if (!styles.body.includes(':root')) {
    throw new Error('Stylesheet does not contain the expected root variables');
  }

  console.log('Smoke test passed against built site.');
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
