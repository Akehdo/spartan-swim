import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const dist = path.resolve(root, 'dist');
if (path.dirname(dist) !== root) throw new Error('Invalid output directory');
for (const file of await readdir(path.join(root, 'src'))) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(root, 'src', file)], { stdio: 'inherit' });
}
const config = JSON.parse(await readFile('public/site-config.json', 'utf8'));
if (config.appsScriptUrl && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.appsScriptUrl)) throw new Error('Invalid Apps Script URL');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp('index.html', path.join(dist, 'index.html'));
await cp('events.html', path.join(dist, 'events.html'));
await cp('events.html', path.join(dist, 'events.html'));
await cp('src', path.join(dist, 'src'), { recursive: true });
await cp('public', dist, { recursive: true });
console.log('Built dist/ — static site, no database or runtime dependencies.');
