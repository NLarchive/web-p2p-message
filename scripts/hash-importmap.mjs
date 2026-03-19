import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const marker = '<script type="importmap">';
const start = html.indexOf(marker) + marker.length;
const end = html.indexOf('</script>', start);
const content = html.slice(start, end);
const lf = content.replace(/\r\n/g, '\n');
console.log('raw  sha256-' + createHash('sha256').update(content).digest('base64'));
console.log('lf   sha256-' + createHash('sha256').update(lf).digest('base64'));
console.log('hasCR:', content.includes('\r'));
