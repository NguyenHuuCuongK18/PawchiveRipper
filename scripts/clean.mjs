import { lstat, readdir, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const generated = new Set(['artifacts', 'coverage', 'releases', '.probe', '.browser-profile']);
const names = (await readdir(root)).filter(name => generated.has(name) ||
  /^\.(?:service|media|selection)-check-/.test(name) ||
  /^KemonoPawchiveArchiveRipper-\d+\.\d+\.\d+\.zip$/.test(name));
for (const name of names) {
  const target = resolve(root, name);
  if (dirname(target) !== root || basename(target) !== name) throw new Error('Cleanup target escaped the project root.');
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new Error('Refusing to clean a symbolic link: ' + name);
  await rm(target, { recursive: true, force: true });
  console.log('Removed generated output: ' + name);
}
