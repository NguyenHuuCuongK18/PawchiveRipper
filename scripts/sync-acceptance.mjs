import { chromium } from 'playwright';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.'), output = resolve(`.service-check-sync-${Date.now()}`);
const buildVersion = JSON.parse(await readFile('dist/manifest.json', 'utf8')).version;
assert(output.startsWith(root + sep)); await mkdir(output);
const source = { origin: 'https://pawchive.pw', platform: 'fanbox', creatorId: '123', postId: null };
const url = source.origin + '/fanbox/user/123', folderName = 'fanbox_123_Creator';
const imagePath = '/aa/bb/' + 'a'.repeat(64) + '.jpg';
const primary = { id: '100', user: '123', service: 'fanbox', title: 'Reward', content: 'First revision', published: '2026-11-01', has_full: true, detail_fetched: true, file: { path: imagePath, name: 'reward.jpg' }, attachments: [] };
const selection = { quality: 'full res', images: true, files: true, text: true, deduplicate: true };
const index = { format: 'archive-ripper-post-sync', version: 1, source, creatorName: 'Creator', selection, posts: [] };
let context, inspectFailure;
const waitFor = async work => { const until = Date.now() + 45000; while (Date.now() < until) { const value = await work(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out waiting for sync acceptance state.'); };
try {
  context = await chromium.launchPersistentContext(resolve(output, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  const access = await context.newPage(); await access.goto(`chrome-extension://${id}/folder/index.html#mode=library`);
  const send = message => access.evaluate(async message => { const reply = await chrome.runtime.sendMessage(message); if (!reply?.ok) throw new Error(reply?.error || 'No response'); return reply.data; }, message);
  inspectFailure = async () => {
    const state = await send({ type: 'LIBRARY_STATUS' });
    return { library: state, jobs: await Promise.all(state.creators.filter(creator => creator.runId).map(async creator => {
      const value = await send({ type: 'POST_DETAIL', jobId: creator.runId });
      return { id: value.job.id, status: value.job.status, error: value.job.error, scan: value.job.scan, totals: value.totals, tasks: value.job.tasks?.map(task => ({ status: task.status, error: task.error })) };
    })) };
  };
  await access.evaluate(async ({ index, folderName }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture-root', { create: true });
    const creator = await root.getDirectoryHandle(folderName, { create: true });
    const out = await (await creator.getFileHandle('sync.json', { create: true })).createWritable(); await out.write(JSON.stringify(index)); await out.close();
    for (const name of ['Unrelated', 'fanbox_999_NoMetadata']) { const dir = await root.getDirectoryHandle(name, { create: true }); const out = await (await dir.getFileHandle('precious.txt', { create: true })).createWritable(); await out.write('KEEP EXACTLY'); await out.close(); }
    window.showDirectoryPicker = async options => { if (options.mode !== 'read') throw new Error('Root must be read-only'); return root; };
  }, { index, folderName });
  await access.getByRole('button', { name: 'Choose archive root (read only)' }).click();
  await waitFor(async () => (await access.locator('#status').textContent()).includes('1 creator connected'));
  let library = await send({ type: 'LIBRARY_STATUS' }); assert.equal(library.creators.length, 1); assert.equal(library.enabled, false);
  const key = library.creators[0].key, directoryId = library.creators[0].directoryId;
  console.log('PASS: read-only root discovery imports valid creator JSON and excludes unrelated/missing-metadata folders.');
  await worker.evaluate(primary => { globalThis.__posts = [primary]; globalThis.__apiRequests = 0; const native = fetch; globalThis.fetch = async (input, init) => {
    const url = String(input); if (!url.includes('/api/v1/')) return native(input, init); globalThis.__apiRequests++;
    if (url.endsWith('/profile')) return new Response(JSON.stringify({ id: '123', name: 'Creator' }));
    if (url.includes('/post/')) return new Response(JSON.stringify(globalThis.__posts.find(post => url.endsWith('/' + post.id))));
    const offset = Number(new URL(url).searchParams.get('o')); return new Response(JSON.stringify(globalThis.__posts.slice(offset, offset + 50)));
  }; }, primary);
  await worker.evaluate(async () => { if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) await chrome.offscreen.createDocument({ url: 'offscreen/index.html', reasons: ['BLOBS'], justification: 'Isolated sync acceptance fixtures.' }); });
  const site = await context.newPage(), cdp = await context.newCDPSession(site), offscreenUrl = `chrome-extension://${id}/offscreen/index.html`;
  async function evaluateOffscreen(expression) {
    const { targetInfos } = await cdp.send('Target.getTargets'), target = targetInfos.find(item => item.url === offscreenUrl); assert(target);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    try {
      const result = new Promise((resolve, reject) => { const listener = event => { if (event.sessionId !== sessionId) return; const message = JSON.parse(event.message); if (message.id !== 1) return; cdp.off('Target.receivedMessageFromTarget', listener); if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message))); else resolve(message.result.result?.value); }; cdp.on('Target.receivedMessageFromTarget', listener); });
      await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }) }); return await result;
    } finally { await cdp.send('Target.detachFromTarget', { sessionId }); }
  }
  const bytes = (await readFile('tests/fixtures/test-image.jpg')).toString('base64');
  await evaluateOffscreen(`(()=>{globalThis.__mediaCount=0;const native=fetch;globalThis.fetch=async(input,init)=>{if(!String(input).startsWith('https:'))return native(input,init);globalThis.__mediaCount++;return new Response(Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0)),{headers:{'content-type':'image/jpeg'}});};return true;})()`);
  await context.route('https://pawchive.pw/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Creator</title>' }));
  await site.goto(url); assert.equal(await worker.evaluate(() => globalThis.__apiRequests), 0);
  await send({ type: 'LIBRARY_AUTO', key, enabled: true }); await send({ type: 'LIBRARY_MODE', mode: 'sync' });
  await site.reload();
  await waitFor(async () => { library = await send({ type: 'LIBRARY_STATUS' }); return library.creators[0].runId; });
  let runId = library.creators[0].runId;
  await waitFor(async () => (await send({ type: 'POST_DETAIL', jobId: runId })).job.status === 'finished');
  assert.equal(await evaluateOffscreen('globalThis.__mediaCount'), 1);
  assert.equal((await send({ type: 'POST_DETAIL', jobId: runId })).job.selection.keepArchives, true);
  await send({ type: 'LOCAL_CLEAR', scope: 'job', jobId: runId });
  assert.equal((await send({ type: 'LIBRARY_STATUS' })).creators[0].directoryId, directoryId);
  console.log('PASS: opening the site starts automatic saving without the overlay; removing job history retains the creator connection.');
  const makeDue = () => access.evaluate(async () => { const db = await new Promise((resolve, reject) => { const request = indexedDB.open('kemono-archive'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); await new Promise((resolve, reject) => { const tx = db.transaction('settings', 'readwrite'), store = tx.objectStore('settings'), request = store.get('creator-library'); request.onsuccess = () => { const library = request.result; library.creators[0].nextCheckAt = 0; store.put(library, 'creator-library'); }; tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close(); });
  await worker.evaluate(primary => { globalThis.__posts = [{ ...primary, id: '101', title: 'Monthly recap' }, primary]; }, primary);
  await makeDue(); await site.reload();
  await waitFor(async () => { const current = (await send({ type: 'LIBRARY_STATUS' })).creators[0].runId; if (current !== runId) { runId = current; return true; } });
  await waitFor(async () => (await send({ type: 'POST_DETAIL', jobId: runId })).job.status === 'finished');
  assert.equal(await evaluateOffscreen('globalThis.__mediaCount'), 1);
  assert((await send({ type: 'POST_DETAIL', jobId: runId })).duplicates > 0);
  console.log('PASS: monthly reposts reuse the earlier source-hash match without another media download.');
  await worker.evaluate(() => { globalThis.__posts[0].content = 'Edited text'; }); await makeDue(); await site.reload();
  const previousId = runId;
  await waitFor(async () => { runId = (await send({ type: 'LIBRARY_STATUS' })).creators[0].runId; return runId !== previousId; });
  await waitFor(async () => (await send({ type: 'POST_DETAIL', jobId: runId })).job.status === 'finished');
  const text = await access.evaluate(async folderName => { const root = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture-root')).getDirectoryHandle(folderName); const sync = JSON.parse(await (await (await root.getFileHandle('sync.json')).getFile()).text()); const entry = sync.posts.find(post => post.id === '101').files.find(file => file.kind === 'text'); let dir = root; const parts = entry.path.split('/'); for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part); return await (await (await dir.getFileHandle(parts.at(-1))).getFile()).text(); }, folderName);
  assert(text.includes('Edited text')); assert.equal(await evaluateOffscreen('globalThis.__mediaCount'), 1);
  console.log('PASS: edits to existing posts update their text revision while preserving media deduplication.');
  await send({ type: 'LIBRARY_MODE', mode: 'check' });
  await worker.evaluate(() => { globalThis.__posts[0].content = 'Check-only edit'; });
  await site.reload();
  await waitFor(async () => (await send({ type: 'LIBRARY_STATUS' })).creators[0].observation === 'recent_changed');
  assert.equal((await send({ type: 'LIBRARY_STATUS' })).creators[0].runId, runId); assert.equal(await evaluateOffscreen('globalThis.__mediaCount'), 1);
  console.log('PASS: check-only mode reports changes without starting a download.');
  await send({ type: 'LIBRARY_MODE', mode: 'off' }); const before = await worker.evaluate(() => globalThis.__apiRequests); await makeDue(); await site.reload();
  await new Promise(resolve => setTimeout(resolve, 500)); assert.equal(await worker.evaluate(() => globalThis.__apiRequests), before);
  const untouched = await access.evaluate(async () => { const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture-root'); const result = []; for (const name of ['Unrelated', 'fanbox_999_NoMetadata']) { const dir = await root.getDirectoryHandle(name), names = []; for await (const entry of dir.values()) names.push(entry.name); result.push([name, names, await (await (await dir.getFileHandle('precious.txt')).getFile()).text()]); } return result; });
  assert.deepEqual(untouched, [['Unrelated', ['precious.txt'], 'KEEP EXACTLY'], ['fanbox_999_NoMetadata', ['precious.txt'], 'KEEP EXACTLY']]);
  const restore = await context.newPage(); await restore.goto(`chrome-extension://${id}/folder/index.html#creator=${encodeURIComponent(key)}`);
  await restore.locator('#allow').waitFor();
  await restore.evaluate(() => { window.showOpenFilePicker = async () => { throw new Error('History must not be selected again'); }; });
  await restore.locator('#allow').click();
  await waitFor(async () => (await restore.locator('#status').textContent()).startsWith('Access allowed.'));
  assert.equal((await send({ type: 'LIBRARY_STATUS' })).creators[0].directoryId, directoryId); await restore.close();
  console.log('PASS: direct creator access restoration reuses its stored handle without another sync.json selection.');
  await access.evaluate(async ({ source, selection }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture-root');
    const other = await root.getDirectoryHandle('fanbox_456_Other', { create: true });
    const out = await (await other.getFileHandle('sync.json', { create: true })).createWritable();
    await out.write(JSON.stringify({ format: 'archive-ripper-post-sync', version: 1, source: { ...source, creatorId: '456' }, creatorName: 'Other', selection, posts: [] })); await out.close();
  }, { source, selection });
  await access.getByRole('button', { name: 'Choose archive root (read only)' }).click();
  await waitFor(async () => (await access.locator('#status').textContent()).includes('2 creators connected'));
  await worker.evaluate(primary => {
    const native = fetch; globalThis.fetch = async (input, init) => {
      const url = String(input); if (!url.includes('/user/456')) return native(input, init); globalThis.__apiRequests++;
      if (url.endsWith('/profile')) return new Response(JSON.stringify({ id: '456', name: 'Other' }));
      const post = { ...primary, id: '200', user: '456', file: {}, title: 'Other text' };
      return new Response(JSON.stringify(url.includes('/post/') ? post : Number(new URL(url).searchParams.get('o')) ? [] : [post]));
    };
  }, primary);
  await worker.evaluate(async url => { const [tab] = await chrome.tabs.query({ url }); await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' }); }, url);
  let frame = await waitFor(() => site.frames().find(frame => frame.url().includes('/overlay/index.html')));
  await frame.locator('#creator-library > summary').click();
  assert((await frame.locator('header').textContent()).includes(`v${buildVersion}`));
  await frame.locator('#library-select-none').click();
  await waitFor(async () => (await frame.locator('#library-status').textContent()).includes('0 selected'));
  assert(await frame.locator('#library-check').isDisabled()); assert(await frame.locator('#library-sync').isDisabled());
  await frame.locator('#library-select-all').click();
  await waitFor(async () => (await frame.locator('#library-status').textContent()).includes('2 selected'));
  await frame.locator('#library-check').click();
  await waitFor(async () => { const batch = (await send({ type: 'LIBRARY_STATUS' })).batch; return batch?.status === 'done' && batch.completed === 2; });
  assert.equal(await evaluateOffscreen('globalThis.__mediaCount'), 1); assert.equal((await send({ type: 'LIBRARY_STATUS' })).enabled, false);
  await waitFor(async () => await frame.locator('#library-sync').isEnabled()); await frame.locator('#library-sync').click();
  await waitFor(async () => { const batch = (await send({ type: 'LIBRARY_STATUS' })).batch; return batch?.status === 'done' && batch.completed === 2 && batch.failed === 0; });
  const beforeRepair = (await send({ type: 'LIBRARY_STATUS' })).creators.find(creator => creator.key === key).runId;
  const missing = await access.evaluate(async folderName => {
    const root = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture-root')).getDirectoryHandle(folderName);
    const index = JSON.parse(await (await (await root.getFileHandle('sync.json')).getFile()).text());
    const path = index.posts.find(post => post.id === '101').files.find(file => file.kind === 'text').path;
    const parts = path.split('/'); if (parts.includes('..') || parts.some(part => !part)) throw new Error('Invalid fixture path');
    let dir = root; for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const text = await (await (await dir.getFileHandle(parts.at(-1))).getFile()).text(); await dir.removeEntry(parts.at(-1)); return { path, text };
  }, folderName);
  await waitFor(async () => await frame.locator('#library-sync').isEnabled()); await frame.locator('#library-sync').click();
  await waitFor(async () => { const value = await send({ type: 'LIBRARY_STATUS' }); return value.batch?.status === 'done' && !value.batch.failed && value.creators.find(creator => creator.key === key).runId !== beforeRepair; });
  const repaired = await access.evaluate(async ({ folderName, path }) => {
    let dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture-root')).getDirectoryHandle(folderName);
    const parts = path.split('/'); for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle(parts.at(-1))).getFile()).text();
  }, { folderName, path: missing.path });
  assert.equal(repaired, missing.text); assert.equal(await evaluateOffscreen('globalThis.__mediaCount'), 1);
  assert.equal((await send({ type: 'LIBRARY_STATUS' })).enabled, false);
  await worker.evaluate(async url => { const [tab] = await chrome.tabs.query({ url }); await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' }); }, url);
  console.log('PASS: bulk selection/check/sync works with auto mode off; a full bulk sync repairs a missing file even when recent posts are unchanged, without duplicate media transfers.');
  const savedLibrary = await send({ type: 'LIBRARY_STATUS' }); delete savedLibrary.runs; delete savedLibrary.batch;
  const setFixtureLibrary = value => access.evaluate(async value => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('kemono-archive'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put(value, 'creator-library'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
  }, value);
  const fixtureLibrary = { enabled: false, checkOnly: true, creators: Array.from({ length: 36 }, (_, i) => ({ ...savedLibrary.creators[0],
    key: i ? `${source.origin}/fanbox/${1000 + i}` : key, source: { ...source, creatorId: i ? String(1000 + i) : '123' },
    creatorName: i ? `Creator ${i}` : 'テスト作者・長いクリエイター名の表示確認', folderName: `fanbox_${i ? 1000 + i : 123}_Creator`,
    directoryId: i ? `missing-${i}` : directoryId, enabled: true, checkedAt: Date.now(), fullCheckedAt: 0, syncedAt: 0,
    runId: undefined, head: undefined, observation: undefined, nextCheckAt: Number.MAX_SAFE_INTEGER,
    error: 'Updates or a full check are due. Turn off check-only mode to save them.' })) };
  await setFixtureLibrary(fixtureLibrary);
  await worker.evaluate(async url => { const [tab] = await chrome.tabs.query({ url }); await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' }); }, url);
  frame = await waitFor(() => site.frames().find(frame => frame.url().includes('/overlay/index.html')));
  const uiErrors = []; site.on('pageerror', error => uiErrors.push(error.message));
  await frame.locator('#creator-library > summary').click();
  await waitFor(async () => await frame.locator('.library-card').count() === 36);
  assert.equal(await frame.locator('#library-mode').inputValue(), 'off');
  assert(await frame.locator('#library-schedule').isHidden());
  assert((await frame.locator('#library-status').textContent()).includes('36 selected'));
  assert.equal(await frame.getByText('First sync needed', { exact: true }).count(), 36);
  assert.equal(await frame.getByText('New or edited posts', { exact: true }).count(), 0);
  const firstCard = frame.locator('.library-card').first();
  assert.equal(await firstCard.getByRole('button', { name: /access/ }).count(), 0);
  assert.equal(await firstCard.locator('.library-detail').isVisible(), false);
  await firstCard.locator('.library-info summary').click(); assert.equal(await firstCard.locator('.library-detail').isVisible(), true);
  await firstCard.locator('.library-info summary').click();
  assert.equal(await frame.getByRole('button', { name: 'Reconnect', exact: true }).count(), 35);
  for (const width of [352, 492, 1100]) {
    await site.setViewportSize({ width, height: 850 });
    const layout = await frame.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, cards: [...document.querySelectorAll('.library-card')].every(card => card.scrollWidth <= card.clientWidth), nameWidth: document.querySelector('.library-creator strong').getBoundingClientRect().width, width: innerWidth }));
    assert(!layout.overflow && layout.cards, JSON.stringify(layout)); assert(layout.nameWidth > layout.width / 2, 'Creator name should have a readable full-width row.');
  }
  await frame.evaluate(() => { globalThis.__permissionRequests = 0; FileSystemDirectoryHandle.prototype.queryPermission = async () => 'prompt'; FileSystemDirectoryHandle.prototype.requestPermission = async () => { globalThis.__permissionRequests++; return 'granted'; }; });
  await frame.locator('#creator-library > summary').click(); await frame.locator('#creator-library > summary').click();
  await waitFor(async () => await firstCard.getByRole('button', { name: 'Allow access', exact: true }).count() === 1);
  assert.equal(await frame.evaluate(() => globalThis.__permissionRequests), 0, 'Rendering must not prompt for folder permission.');
  await firstCard.locator('input[type=checkbox]').uncheck();
  await waitFor(async () => (await frame.locator('#library-status').textContent()).includes('35 selected'));
  await frame.locator('#library-mode').selectOption('check');
  await waitFor(async () => (await send({ type: 'LIBRARY_STATUS' })).checkOnly && (await send({ type: 'LIBRARY_STATUS' })).enabled);
  assert((await frame.locator('#library-mode-help').textContent()).includes('No downloads'));
  assert(await frame.locator('#library-schedule').isVisible());
  await frame.locator('#library-mode').selectOption('off'); await waitFor(async () => !(await send({ type: 'LIBRARY_STATUS' })).enabled);
  await frame.locator('#library-check').click();
  await waitFor(async () => (await send({ type: 'LIBRARY_STATUS' })).batch?.status === 'running');
  await frame.locator('#library-stop').click();
  await waitFor(async () => (await send({ type: 'LIBRARY_STATUS' })).batch?.status === 'stopped');
  assert.deepEqual((await send({ type: 'LIBRARY_STATUS' })).batch.pending, []);
  const unchangedAfterBulk = await access.evaluate(async () => { const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture-root'); const result = []; for (const name of ['Unrelated', 'fanbox_999_NoMetadata']) { const dir = await root.getDirectoryHandle(name), names = []; for await (const entry of dir.values()) names.push(entry.name); result.push([name, names, await (await (await dir.getFileHandle('precious.txt')).getFile()).text()]); } return result; });
  assert.deepEqual(unchangedAfterBulk, untouched);
  assert.deepEqual(uiErrors, []);
  await mkdir(resolve('artifacts'), { recursive: true }); await site.setViewportSize({ width: 492, height: 950 });
  await frame.locator('#creator-library').evaluate(element => scrollTo(0, Math.max(0, element.getBoundingClientRect().top + scrollY - document.querySelector('header').getBoundingClientRect().height - 12)));
  await site.screenshot({ path: resolve('artifacts/library-ui.png') });
  await worker.evaluate(async url => { const [tab] = await chrome.tabs.query({ url }); await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' }); }, url);
  await setFixtureLibrary(savedLibrary);
  console.log('PASS: 36-creator UI distinguishes missing baselines, shows truthful permission actions without prompts, supports explicit modes, and fits narrow/wide layouts.');
  await access.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('kemono-archive'); request.onsuccess = () => resolve(request.result); });
    await new Promise((resolve, reject) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ 'https://pawchive.pw': Date.now() + 600000 }, 'host-cooldowns'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
  });
  await send({ type: 'LIBRARY_BATCH', action: 'check' });
  await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
  library = await send({ type: 'LIBRARY_STATUS' }); assert.equal(library.enabled, false); assert.equal(library.creators.find(creator => creator.key === key).directoryId, directoryId);
  assert.equal(library.batch.status, 'running'); assert.equal(library.batch.pending.length, 2);
  await send({ type: 'LIBRARY_STOP' }); assert.equal((await send({ type: 'LIBRARY_STATUS' })).batch.status, 'stopped');
  console.log('PASS: settings and a rate-limited bulk queue survive worker restart; Stop clears the queue and unrelated fixture folders remain intact.');
} catch (error) {
  if (inspectFailure) console.error('Sync fixture state:', JSON.stringify(await inspectFailure().catch(error => ({ error: error.message }))));
  throw error;
} finally {
  await context?.close(); assert(output.startsWith(root + sep) && output.includes('.service-check-sync-')); await rm(output, { recursive: true, force: true });
  console.log('Removed temporary sync browser profile and fixtures.');
}
