import { mkdir, copyFile, readdir, stat, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

async function copyRecursive(source, destination) {
  const sourceStat = await stat(source);

  if (sourceStat.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source);
    for (const entry of entries) {
      await copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

// Remove files that are not needed at runtime from a vendor directory tree.
// .ts source files and .map source-map files are only useful during development;
// shipping them causes browsers (with DevTools open) to issue connect-src CSP
// violation reports when they try to resolve source maps. Stripping the
// sourceMappingURL comment from .js files stops the chain entirely.
async function cleanVendorDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await cleanVendorDir(full);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.map')) {
      await rm(full);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs') || entry.name.endsWith('.mjs')) {
      const src = await readFile(full, 'utf8');
      const cleaned = src.replace(/\s*\/\/# sourceMappingURL=\S+\s*$/gm, '');
      if (cleaned !== src) await writeFile(full, cleaned, 'utf8');
    }
  }));
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await copyRecursive(path.join(rootDir, 'index.html'), path.join(distDir, 'index.html'));
await copyRecursive(path.join(rootDir, 'src'), path.join(distDir, 'src'));
await copyRecursive(path.join(rootDir, 'node_modules', '@noble', 'post-quantum'), path.join(distDir, 'vendor', '@noble', 'post-quantum'));
await copyRecursive(path.join(rootDir, 'node_modules', '@noble', 'curves'), path.join(distDir, 'vendor', '@noble', 'curves'));
await copyRecursive(path.join(rootDir, 'node_modules', '@noble', 'hashes'), path.join(distDir, 'vendor', '@noble', 'hashes'));
await cleanVendorDir(path.join(distDir, 'vendor'));

// Normalise index.html to LF and inject the correct importmap CSP hash so the
// deployed file is always self-consistent regardless of OS line endings.
const indexPath = path.join(distDir, 'index.html');
let html = await readFile(indexPath, 'utf8');
html = html.replace(/\r\n/g, '\n');

const importmapMatch = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/);
if (importmapMatch) {
  const importmapContent = importmapMatch[1];
  const hash = createHash('sha256').update(importmapContent, 'utf8').digest('base64');
  html = html.replace(/'sha256-[A-Za-z0-9+/=]+'/, `'sha256-${hash}'`);
}

await writeFile(indexPath, html, 'utf8');

console.log('Built static site into dist/');
