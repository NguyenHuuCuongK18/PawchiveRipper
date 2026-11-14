import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.'), output = resolve(`.service-check-permissions-${Date.now()}`);
assert(output.startsWith(root + sep)); await mkdir(output);
const origin = 'https://pawchive.pw', ids = ['123', '456', '789', '900', '901', '902', '904'];
const folderName = id => `fanbox_${id}_Creator`;
let context;
async function waitFor(work) {
  const until = Date.now() + 30000;
  while (Date.now() < until) { const value = await work(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Timed out waiting for first-sync permission state.');
}
try {
  context = await chromium.launchPersistentContext(resolve(output, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  // OPFS is already granted by the browser. These UI-only shims model native
  // prompt/denial states while retaining real directory handles and archive IO.
  await context.addInitScript(() => {
    const prototype = FileSystemDirectoryHandle.prototype;
    prototype.queryPermission = async function ({ mode }) {
      return mode === 'read' ? 'granted' : JSON.parse(localStorage.getItem('fixture-permissions') || '{}')[this.name] || 'granted';
    };
    prototype.requestPermission = function ({ mode }) {
      if (!navigator.userActivation.isActive) throw new DOMException('Missing user gesture', 'SecurityError');
      const requests = JSON.parse(localStorage.getItem('fixture-requests') || '[]'); requests.push({ name: this.name, mode }); localStorage.setItem('fixture-requests', JSON.stringify(requests));
      const denied = globalThis.__denyNext === this.name; globalThis.__denyNext = undefined;
      const states = JSON.parse(localStorage.getItem('fixture-permissions') || '{}'); states[this.name] = denied ? 'denied' : 'granted'; localStorage.setItem('fixture-permissions', JSON.stringify(states));
      return Promise.resolve(states[this.name]);
    };
    window.showDirectoryPicker = async () => { throw new Error('Permission queue must not open a folder picker'); };
    window.showOpenFilePicker = async () => { throw new Error('Permission queue must not ask for history'); };
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), extension = new URL(worker.url()).hostname;
  const access = await context.newPage(); await access.goto(`chrome-extension://${extension}/folder/index.html#mode=library`);
  const send = message => access.evaluate(async message => { const reply = await chrome.runtime.sendMessage(message); if (!reply?.ok) throw new Error(reply?.error || 'No response'); return reply.data; }, message);
  await access.evaluate(async ids => {
    const fixture = await (await navigator.storage.getDirectory()).getDirectoryHandle('permission-fixture', { create: true });
    for (const id of ids) {
      const dir = await fixture.getDirectoryHandle(`fanbox_${id}_Creator`, { create: true });
      const handle = await dir.getFileHandle('sync.json', { create: true }), writer = await handle.createWritable();
      await writer.write(JSON.stringify({ format: 'archive-ripper-post-sync', version: 1, source: { origin: 'https://pawchive.pw', platform: 'fanbox', creatorId: id, postId: null }, creatorName: `Creator ${id}`, selection: { quality: 'full res', images: true, files: true, text: true }, posts: [] })); await writer.close();
    }
    for (const name of ['Unrelated', 'fanbox_999_NoJSON']) { const dir = await fixture.getDirectoryHandle(name, { create: true }), writer = await (await dir.getFileHandle('precious.txt', { create: true })).createWritable(); await writer.write('KEEP EXACTLY'); await writer.close(); }
    localStorage.setItem('fixture-permissions', JSON.stringify(Object.fromEntries(ids.map(id => [`fanbox_${id}_Creator`, id === '789' ? 'granted' : 'prompt']))));
    window.showDirectoryPicker = async options => { if (options.mode !== 'read') throw new Error('Root must stay read-only'); return fixture; };
  }, ids);
  await access.getByRole('button', { name: 'Choose archive root (read only)' }).click();
  await waitFor(async () => (await send({ type: 'LIBRARY_STATUS' })).creators.length === ids.length);
  for (const id of ids.filter(id => id !== '901')) await send({ type: 'LIBRARY_AUTO', key: `${origin}/fanbox/${id}`, enabled: true });
  await access.evaluate(async () => {
    const fixture = await (await navigator.storage.getDirectory()).getDirectoryHandle('permission-fixture');
    await (await fixture.getDirectoryHandle('fanbox_902_Creator')).removeEntry('sync.json');
    const db = await new Promise(resolve => { const request = indexedDB.open('kemono-archive'); request.onsuccess = () => resolve(request.result); });
    await new Promise((resolve, reject) => { const tx = db.transaction('settings', 'readwrite'), store = tx.objectStore('settings'), request = store.get('creator-library'); request.onsuccess = () => { const library = request.result, synced = library.creators.find(item => item.source.creatorId === '900'); synced.head = '[]'; synced.fullCheckedAt = Date.now(); store.put(library, 'creator-library'); }; tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
  });
  const snapshot = () => access.evaluate(async () => {
    const result = [];
    async function visit(dir, prefix) { const entries = []; for await (const entry of dir.values()) entries.push(entry); entries.sort((a, b) => a.name.localeCompare(b.name)); for (const entry of entries) { const path = prefix + entry.name; if (entry.kind === 'directory') { result.push([path + '/', null]); await visit(entry, path + '/'); } else result.push([path, Array.from(new Uint8Array(await (await entry.getFile()).arrayBuffer()))]); } }
    await visit(await (await navigator.storage.getDirectory()).getDirectoryHandle('permission-fixture'), ''); return result;
  });
  const before = await snapshot();
  await worker.evaluate(() => { const native = fetch; globalThis.__apiRequests = 0; globalThis.fetch = (...args) => { if (String(args[0]).includes('/api/v1/')) { globalThis.__apiRequests++; throw new Error('Permission-only flow must not fetch posts'); } return native(...args); }; });
  await context.route('https://pawchive.pw/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Creator library</title>' }));
  const site = await context.newPage(); await site.goto(origin + '/');
  await worker.evaluate(async url => { const [tab] = await chrome.tabs.query({ url }); await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' }); }, origin + '/');
  const frame = await waitFor(() => site.frames().find(frame => frame.url().includes('/overlay/index.html')));
  await frame.locator('#creator-library > summary').click();
  await frame.locator('#library-allow-first').waitFor();
  assert((await frame.locator('#library-allow-first').textContent()).includes('(4)'));
  const opened = context.waitForEvent('page'); await frame.locator('#library-allow-first').click(); const permission = await opened; await permission.waitForLoadState();
  await permission.locator('#permission-allow').waitFor();
  await waitFor(async () => await permission.locator('#permission-allow').isEnabled());
  assert.equal(await permission.locator('#permission-creator').textContent(), 'Creator 123');
  assert.deepEqual(await permission.evaluate(() => JSON.parse(localStorage.getItem('fixture-requests') || '[]')), []);
  assert.equal(await permission.getByRole('button', { name: /archive root/ }).isVisible(), false);
  await mkdir(resolve('artifacts'), { recursive: true }); await permission.screenshot({ path: resolve('artifacts/first-sync-permissions.png') });
  await permission.evaluate(() => { globalThis.__denyNext = 'fanbox_123_Creator'; });
  await permission.locator('#permission-allow').click();
  await waitFor(async () => (await permission.locator('#permission-status').textContent()).startsWith('Not allowed.'));
  assert.equal(await permission.locator('#permission-creator').textContent(), 'Creator 123');
  await permission.locator('#permission-allow').click();
  await waitFor(async () => (await permission.locator('#permission-creator').textContent()) === 'Creator 456');
  const requestedBeforeNextClick = await permission.evaluate(() => JSON.parse(localStorage.getItem('fixture-requests')));
  assert.deepEqual(requestedBeforeNextClick.map(item => item.name), [folderName('123'), folderName('123')]);
  await permission.locator('#permission-allow').click();
  await waitFor(async () => (await permission.locator('#permission-creator').textContent()) === 'Creator 904');
  await permission.locator('#permission-skip').click();
  await waitFor(async () => (await permission.locator('#permission-creator').textContent()) === 'Done');
  assert.equal(await permission.locator('#permission-progress').textContent(), '2 allowed · 2 skipped · 0 remaining');
  const requested = await permission.evaluate(() => JSON.parse(localStorage.getItem('fixture-requests')));
  assert.deepEqual(requested, [{ name: folderName('123'), mode: 'readwrite' }, { name: folderName('123'), mode: 'readwrite' }, { name: folderName('456'), mode: 'readwrite' }]);
  assert.equal((await send({ type: 'SERVICE_JOBS' })).length, 0); assert.equal(await worker.evaluate(() => globalThis.__apiRequests), 0);
  assert.deepEqual(await snapshot(), before);
  console.log('PASS: one button opens the first-sync permission queue; each prepared child requires its own click, denial can retry, and the next folder loads without a picker.');
  console.log('PASS: already allowed, completed, unselected, missing-JSON and unrelated folders receive no permission request; no downloads or archive-file changes occur.');
  for (const id of ['902', '904']) await send({ type: 'LIBRARY_AUTO', key: `${origin}/fanbox/${id}`, enabled: false });
  await permission.close(); await site.bringToFront();
  await frame.evaluate(() => window.dispatchEvent(new Event('focus')));
  await waitFor(async () => await frame.locator('#library-allow-first').isHidden());
  console.log('PASS: the permission button disappears when no selected first-sync folders need access.');
} finally {
  await context?.close(); assert(output.startsWith(root + sep) && output.includes('.service-check-permissions-')); await rm(output, { recursive: true, force: true });
  console.log('Removed temporary permission profile and fixture folders.');
}
