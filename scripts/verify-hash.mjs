import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const html = await readFile('dist/index.html', 'utf8');
const hasCR = html.includes('\r');
const cspMatch = html.match(/'sha256-[A-Za-z0-9+/=]+'/);
const impMatch = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/);

const csp = cspMatch?.[0];
const imp = impMatch?.[1];
const hash = imp ? createHash('sha256').update(imp, 'utf8').digest('base64') : null;

console.log('hasCR   :', hasCR);
console.log('CSP hash:', csp);
console.log('computed:', hash ? `'sha256-${hash}'` : '(no importmap found)');
console.log('match   :', csp === `'sha256-${hash}'`);
