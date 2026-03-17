import http from 'node:http';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function resolvePath(urlPath) {
  const cleanPath = urlPath === '/' ? '/index.html' : urlPath;
  return path.join(distDir, cleanPath.replace(/^\/+/, ''));
}

const server = http.createServer(async (req, res) => {
  const filePath = resolvePath(req.url || '/');

  try {
    await access(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Preview server running at http://127.0.0.1:${port}`);
});
