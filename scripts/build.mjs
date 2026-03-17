import { mkdir, copyFile, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await copyRecursive(path.join(rootDir, 'index.html'), path.join(distDir, 'index.html'));
await copyRecursive(path.join(rootDir, 'src'), path.join(distDir, 'src'));
await copyRecursive(path.join(rootDir, 'node_modules', '@noble', 'post-quantum'), path.join(distDir, 'vendor', '@noble', 'post-quantum'));
await copyRecursive(path.join(rootDir, 'node_modules', '@noble', 'curves'), path.join(distDir, 'vendor', '@noble', 'curves'));
await copyRecursive(path.join(rootDir, 'node_modules', '@noble', 'hashes'), path.join(distDir, 'vendor', '@noble', 'hashes'));

console.log('Built static site into dist/');
