import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { syntheticFixtures } from './make-test-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const staged = process.argv.includes('--staged');
const blocked = /(?:^|\/)(?:node_modules|dist|artifacts|releases|coverage|\.git|\.aws|\.codex|\.agents|\.probe|\.browser-profile|\.compat-blocklist|\.(?:service|media|selection|privacy)-check-[^/]*)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|Cookies|History|Login Data|sync\.json|settings\.json|recon\.json)$|\.sanitized\.(?:json|html)$/i;
const secrets = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}\b/],
  ['Discord MFA token', /\bmfa\.[A-Za-z0-9_-]{40,}\b/],
  ['personal Windows path', /\b[A-Z]:[\\/]+Users[\\/]+[^\\/\r\n"']+/i],
  ['personal email', /\b[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo|protonmail)\.(?:com|net)\b/i]
];
// These are the reviewed generated JPEG/text archives and licensed libarchive
// decoder samples. A replacement needs a deliberate provenance/digest review.
const approvedAssets = new Map(Object.entries({
  'test-image.jpg': 'a554f037f68087928d3893bc61386f29ecc2367b0946ab1bdc54cfbbcf5f27dd',
  'archives/sample.7z': 'e824a69cb52a9fdf86c1343f421cb5fcee036e1adf0c4bc9ab23470c896d5e9a',
  'archives/sample.tar.gz': 'c636709369155b3c787a6f0c6aa7fb49ae2d3e701536f049e733f766576c23cb',
  'archives/rar4-encrypted.rar': 'c30dc6d10e59aaab1c863afa469d188c644a22d67d6e50ac7ca887e520f5fc8b',
  'archives/rar4-encrypted.uu': '42dbdbebe72842c255ef9d600a37ca38cde2133e07abfcf49512dcb81280c746',
  'archives/rar4-subblock.rar': 'e871277670529329cc2c06f178ced453c560d03fd26c76614f42ef9c06b50af0',
  'archives/rar4-subblock.uu': 'cadc9188981382fb25762128fdaf9b9b62d4cb5a0fe0838e3b16013b80f160d3',
  'archives/rar5-solid.rar': '0aa2c652c06304dedd93019663c1d52d5e85055d5fdb8045bfcc4345b90b4a0f',
  'archives/rar5-solid.uu': '0184822d0b061ae1a705a46cf1ca4adb4981b9e37bdb6500a48530a19c56fd88',
  'archives/rar5-stored.rar': '35d75e315d164d2e329afc28f7d844f013271b4fcffd4ddd78efcdd114a383a7',
  'archives/rar5-stored.uu': 'ec73ba623a8e8eee4909dcdf45f0526ff9adc1d856d054ce742e6c1ba1fb5fa8'
}));
const expectedFixtures = new Map([...syntheticFixtures()].map(([name, contents]) => ['tests/fixtures/' + name, Buffer.from(contents)]));
function findings(name, bytes) {
  const result = [];
  if (blocked.test(name) && !/^docs\/releases\/v\d+\.\d+\.\d+\.md$/.test(name)) result.push('private/generated path');
  if (name.startsWith('tests/fixtures/')) {
    if (expectedFixtures.has(name)) {
      if (!bytes.equals(expectedFixtures.get(name))) result.push('metadata differs from the synthetic generator');
    } else if (approvedAssets.has(name.slice('tests/fixtures/'.length))) {
      if (createHash('sha256').update(bytes).digest('hex') !== approvedAssets.get(name.slice('tests/fixtures/'.length))) result.push('unreviewed fixture asset bytes');
      return result;
    } else if (!['tests/fixtures/README.md', 'tests/fixtures/archives/README.md'].includes(name)) result.push('unapproved fixture file');
  }
  if (bytes.includes(0)) return [...result, 'unreviewed binary file'];
  const text = bytes.toString('utf8');
  for (const [label, pattern] of secrets) {
    if (label === 'personal email' && (name.startsWith('licenses/') || name === 'LICENSE')) continue;
    const match = pattern.exec(text);
    if (match) result.push(`${label} at line ${text.slice(0, match.index).split('\n').length}`);
  }
  return result;
}
// Regression examples remain in memory; no secret-looking test tokens are
// written to disk or printed by this check.
assert(findings('artifacts/capture.json', Buffer.from('{}')).length);
assert(findings('src/example.ts', Buffer.from('ghp_' + 'A'.repeat(36))).some(message => message.startsWith('GitHub')));
assert(findings('src/example.ts', Buffer.from('AKIA' + 'A'.repeat(16))).some(message => message.startsWith('AWS')));
assert(findings('src/example.ts', Buffer.from(['C:', 'Users', 'fixture-user', 'Cookies'].join(String.fromCharCode(92)))).some(message => message.startsWith('personal Windows')));
assert(findings('tests/fixtures/live.json', Buffer.from('{}')).includes('unapproved fixture file'));
assert.equal(findings('src/example.ts', Buffer.from('export const safe = true;')).length, 0);
assert.equal(findings('docs/releases/v1.1.0.md', Buffer.from('Release notes.')).length, 0);

const command = staged ? ['ls-files', '--cached', '-z'] : ['ls-files', '-c', '-o', '--exclude-standard', '-z'];
const names = [...new Set(execFileSync('git', command, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
let checked = 0; const failures = [], present = new Set();
for (const name of names) {
  const path = resolve(root, name); if (!path.startsWith(resolve(root) + sep)) throw new Error('Publish path escaped the repository.');
  let bytes;
  if (staged) bytes = execFileSync('git', ['show', ':' + name], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  else {
    try { if ((await lstat(path)).isSymbolicLink()) { failures.push(`${name}: symbolic link`); continue; } bytes = await readFile(path); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  }
  present.add(name); checked++;
  for (const reason of findings(name, bytes)) failures.push(`${name}: ${reason}`);
}
for (const name of expectedFixtures.keys()) if (!present.has(name)) failures.push(`${name}: missing synthetic fixture`);
if (failures.length) {
  // Never include matched values: a scanner finding may itself be a secret.
  console.error('Privacy check failed:\n' + failures.join('\n')); process.exitCode = 1;
} else console.log(`Privacy check passed for ${checked} ${staged ? 'staged' : 'publish-candidate'} files, ${expectedFixtures.size} synthetic fixtures and reviewed fixture assets.`);
