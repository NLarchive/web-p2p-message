// Build dist/ then start the preview server for Playwright e2e tests.
// Playwright's webServer keeps this process alive until all tests finish.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

execSync('node ' + path.join(__dirname, 'build.mjs'), { stdio: 'inherit' });

await import('./preview.mjs');
