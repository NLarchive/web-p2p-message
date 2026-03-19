import { mkdir, cp, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

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

async function setupVendor() {
  const vendorNoble = path.join(rootDir, 'vendor', '@noble');
  const modulesNoble = path.join(rootDir, 'node_modules', '@noble');

  try {
    await mkdir(vendorNoble, { recursive: true });
    await cp(modulesNoble, vendorNoble, { recursive: true, force: true });
    await cleanVendorDir(path.join(rootDir, 'vendor'));
    console.log('✅ Vendor files mapped to /vendor/ (cleaned .ts, .map, sourceMappingURL).');
  } catch (err) {
    console.error('Failed to copy vendor files:', err.message);
  }
}

setupVendor();
