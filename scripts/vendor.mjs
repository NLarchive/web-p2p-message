import { mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function setupVendor() {
  const vendorNoble = path.join(rootDir, 'vendor', '@noble');
  const modulesNoble = path.join(rootDir, 'node_modules', '@noble');

  try {
    await mkdir(vendorNoble, { recursive: true });
    await cp(modulesNoble, vendorNoble, { recursive: true, force: true });
    console.log('✅ Vendor files successfully mapped to project root (/vendor/) for local dev server.');
  } catch (err) {
    console.error('Failed to copy vendor files:', err.message);
  }
}

setupVendor();
