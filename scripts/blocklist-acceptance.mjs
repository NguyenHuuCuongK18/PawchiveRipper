import { chromium } from 'playwright';
import { BlobWriter, TextReader, ZipWriter, ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

// Synthetic bytes and metadata, using the partitioned path shape observed on the reported creator.
const root = resolve('.'), output = resolve(`.service-check-blocklist-${Date.now()}`);
assert(output.startsWith(root + sep));
const blocklist = resolve(process.env.PAWCHIVE_BLOCKLIST_DIR || '../PawchiveBlockList/extension'), extensions = `${resolve('dist')},${blocklist}`;
await mkdir(output);
const source = 'https://pawchive.pw/fanbox/user/32539349';
const path = (partition, letter, ext) => `/${partition}${letter.repeat(2)}/bb/${letter.repeat(64)}.${ext}`;
const imagePath = path('2', 'a', 'png'), videoPath = path('1', 'c', 'mp4'), zipPath = path('2', 'd', 'zip');
const thumbnail = `/thumbnail/data/aa/bb/${'a'.repeat(64)}.png`;
const image = await readFile('tests/fixtures/test-image.jpg');
const video = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
await writer.add('nested/unpacked.txt', new TextReader('Archive extraction fixture'));
const zipped = Buffer.from(await (await writer.close()).arrayBuffer());
const post = { id: '100', user: '32539349', service: 'fanbox', title: 'Partitioned media fixture', content: 'Saved fixture text',
  published: '2026-11-06T17:58:24', detail_fetched: true, has_full: true,
  file: { name: 'cover.png', path: imagePath, server: 'https://n1.pawchive.pw' },
  attachments: [{ name: 'clip.mp4', path: videoPath, server: 'https://n4.pawchive.pw' }, { name: 'bundle.zip', path: zipPath, server: 'https://n3.pawchive.pw' }] };
let context, diagnostic = async () => ({}), imageStatus = 200;
const requests = [], errors = [];
async function waitFor(work) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { const value = await work(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error('Compatibility check timed out: ' + JSON.stringify(await diagnostic()));
}
try {
  context = await chromium.launchPersistentContext(resolve(output, 'profile'), { channel: 'chromium', headless: true, acceptDownloads: true,
    viewport: { width: 1280, height: 950 }, args: [`--disable-extensions-except=${extensions}`, `--load-extension=${extensions}`] });
  const worker = await waitFor(() => context.serviceWorkers().find(worker => worker.url().endsWith('/background.js')));
  const blockWorker = await waitFor(() => context.serviceWorkers().find(worker => worker.url().endsWith('/background/index.js')));
  await worker.evaluate(post => {
    const nativeFetch = fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (!url.pathname.startsWith('/api/v1/')) return nativeFetch(input, init);
      if (url.pathname.endsWith('/profile')) return new Response(JSON.stringify({ id: post.user, name: 'Fixture creator' }));
      if (url.pathname.includes('/post/')) return new Response(JSON.stringify(post));
      return new Response(JSON.stringify(Number(url.searchParams.get('o')) === 0 ? [post] : []));
    };
    const download = chrome.downloads.download.bind(chrome.downloads);
    chrome.downloads.download = options => download({ ...options, saveAs: false });
  }, post);
  await context.route('https://**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Compatibility fixture</title>
    <div class="paginator">Showing 1 - 1 of 1</div><section class="card-list"><div class="card-list__items">
    <article class="post-card" data-id="100" data-user="32539349" data-service="fanbox"><a href="${source}/post/100">Partitioned media fixture</a></article></div></section>` }));
  const manager = await context.newPage();
  await manager.goto(new URL('/manager/index.html', blockWorker.url()).href);
  await manager.evaluate(async () => {
    const reply = await chrome.runtime.sendMessage({ type: 'BLOCK', entry: { site: 'pawchive', kind: 'user', service: 'fanbox', userId: '32539349' } });
    if (!reply.ok) throw new Error(reply.error);
  });
  // Keep the fixture creator tab active for the ripper's PAGE_CONTEXT lookup.
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  page.on('pageerror', error => errors.push(error.message));
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
  await page.goto(source);
  await page.locator('#pawchive-blocklist-toolbar').waitFor();
  assert.equal(await page.locator('.post-card').count(), 0);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, source);
  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_OVERLAY' }), tabId);
  const frame = await waitFor(() => page.frames().find(frame => frame.url().includes('/overlay/index.html')));
  const send = message => frame.evaluate(async message => { const reply = await chrome.runtime.sendMessage(message); if (!reply.ok) throw new Error(reply.error); return reply.data; }, message);
  const jobId = await waitFor(async () => (await send({ type: 'SERVICE_JOBS' }))[0]?.id);
  const detail = () => send({ type: 'POST_DETAIL', jobId });
  diagnostic = async () => ({ view: await detail(), notice: await frame.locator('#notice').textContent(), requests, errors });
  await waitFor(async () => (await detail()).job.scan.complete);
  assert.equal((await detail()).totals.images, 1); assert.equal((await detail()).totals.files, 2);
  assert.equal(await frame.locator('header strong').textContent(), 'Pawchive Ripper');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#c4afff');
  const reveal = showUsers => manager.evaluate(async showUsers => {
    const reply = await chrome.runtime.sendMessage({ type: 'SET_DISPLAY', site: 'pawchive', patch: { showUsers } });
    if (!reply.ok) throw new Error(reply.error);
  }, showUsers);
  await reveal(true);
  await waitFor(async () => await page.locator('.post-card').count() === 1);
  await reveal(false);
  await waitFor(async () => await page.locator('.post-card').count() === 0);
  assert.equal(await page.locator('#archive-ripper-overlay').count(), 1);
  console.log('PASS: both extensions coexist; API discovery finds images, MP4 and ZIP while every creator card is blocked.');

  // Recreate an existing text-only scan, then exercise the visible upgrade action.
  await worker.evaluate(async jobId => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('kemono-archive', 4); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('postJobs', 'readwrite'), store = tx.objectStore('postJobs'), request = store.get(jobId);
      request.onsuccess = () => { const job = request.result; delete job.scan.mediaVersion; for (const post of job.posts) post.media = []; store.put(job); };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
  }, jobId);
  await frame.locator('#refresh-media').waitFor(); await frame.locator('#refresh-media').click();
  await waitFor(async () => (await detail()).job.scan.complete && (await detail()).totals.files === 2);
  assert.equal((await detail()).needsMediaRescan, false);
  console.log('PASS: an existing text-only scan refreshes to recover images and MP4 without clearing extension data.');

  await worker.evaluate(async () => {
    if (!(await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length)
      await chrome.offscreen.createDocument({ url: 'offscreen/index.html', reasons: [chrome.offscreen.Reason.BLOBS], justification: 'Verify partitioned media and Blocklist compatibility.' });
  });
  const offscreenUrl = new URL('/offscreen/index.html', worker.url()).href;
  const target = await waitFor(async () => (await cdp.send('Target.getTargets')).targetInfos.find(target => target.url === offscreenUrl));
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let commandId = 0; const pending = new Map();
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId; pending.set(id, { resolve, reject });
    cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  });
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.id) {
      const callback = pending.get(message.id); if (!callback) return; pending.delete(message.id);
      if (message.error || message.result?.exceptionDetails) callback.reject(new Error(JSON.stringify(message))); else callback.resolve(message.result);
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params, url = new URL(request.url);
      requests.push(url.href);
      const bytes = url.hostname === 'n1.pawchive.pw' && url.pathname === '/data' + imagePath || url.hostname === 'img.pawchive.pw' && url.pathname === thumbnail ? image :
        url.hostname === 'n4.pawchive.pw' && url.pathname === '/data' + videoPath ? video : url.hostname === 'n3.pawchive.pw' && url.pathname === '/data' + zipPath ? zipped : null;
      const status = !bytes ? 404 : url.pathname === '/data' + imagePath ? imageStatus : 200;
      command('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: bytes === image ? 'image/png' : 'application/octet-stream' }], body: status === 200 ? bytes.toString('base64') : '' }).catch(error => errors.push(error.message));
    }
  });
  await command('Fetch.enable', { patterns: [{ urlPattern: 'https://*/*' }] });
  const evaluate = async expression => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
  await frame.locator('#destination-zip').check(); await frame.locator('#extract-archives').check();
  await frame.locator('#download').click();
  await waitFor(async () => (await detail()).job.archive?.state === 'saved');
  const selection = (await detail()).job.selection;
  async function zipEntries() {
    const [download] = await worker.evaluate(() => chrome.downloads.search({ orderBy: ['-startTime'] }));
    const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(await readFile(download.filename))), { useWebWorkers: false });
    try { return await Promise.all((await zip.getEntries()).map(async entry => ({ path: entry.filename, bytes: [...await entry.getData(new Uint8ArrayWriter())] }))); }
    finally { await zip.close(); }
  }
  const entries = await zipEntries();
  assert.deepEqual(entries.find(entry => entry.path.endsWith('_clip.mp4')).bytes, [...video]);
  assert.deepEqual(entries.find(entry => /_cover\.(?:png|jpg)$/.test(entry.path)).bytes, [...image]);
  assert(entries.some(entry => entry.path.endsWith('.zip.extracted/nested/unpacked.txt')));
  assert(!entries.some(entry => entry.path.endsWith('_bundle.zip')));
  assert.equal((await detail()).totals.extractionFailures, 0);
  console.log('PASS: native media fetch saves image and MP4 bytes in the ZIP; optional extraction unpacks only the ZIP attachment.');

  await evaluate(`(async()=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('compatibility-folder',{create:true});const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kemono-archive-destinations',1);r.onupgradeneeded=()=>r.result.createObjectStore('folders');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction('folders','readwrite');tx.objectStore('folders').put(dir,'compatibility-folder');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();return true;})()`);
  await send({ type: 'POST_FOLDER', jobId, directoryId: 'compatibility-folder', name: 'Compatibility folder' });
  await send({ type: 'POST_DOWNLOAD', jobId, selection, destination: 'folder' });
  await waitFor(async () => (await detail()).job.status === 'finished');
  const snapshot = () => evaluate(`(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('compatibility-folder');const files=[];async function walk(dir,prefix=''){for await(const entry of dir.values()){if(entry.kind==='directory')await walk(entry,prefix+entry.name+'/');else files.push({path:prefix+entry.name,bytes:[...new Uint8Array(await(await entry.getFile()).arrayBuffer())]});}}await walk(root);return files;})()`);
  const files = await snapshot();
  assert.deepEqual(files.find(file => file.path.endsWith('_clip.mp4')).bytes, [...video]);
  assert(files.some(file => file.path.endsWith('.zip.extracted/nested/unpacked.txt')));
  const before = requests.length;
  await send({ type: 'POST_DOWNLOAD', jobId, selection, destination: 'folder' });
  await waitFor(async () => (await detail()).job.status === 'finished');
  assert.equal(requests.length, before);
  console.log('PASS: creator-folder saving and subsequent sync keep partitioned media and extracted contents without redownloading them.');

  imageStatus = 404;
  const fallbackId = (await send({ type: 'POST_START', url: source + '/post/100' })).jobId;
  await waitFor(async () => (await send({ type: 'POST_DETAIL', jobId: fallbackId })).job.scan.complete);
  await send({ type: 'POST_DOWNLOAD', jobId: fallbackId, selection: { quality: 'full res', images: true, files: false, text: false, fallbackToThumbnail: true }, destination: 'zip' });
  await waitFor(async () => (await send({ type: 'POST_DETAIL', jobId: fallbackId })).job.archive?.state === 'saved');
  const fallback = await zipEntries();
  assert(fallback.some(entry => entry.path.includes('/thumbnail/') && /_cover\.(?:png|jpg)$/.test(entry.path)));
  assert(requests.some(url => new URL(url).pathname === thumbnail));
  assert.deepEqual(errors, []);
  await mkdir('artifacts', { recursive: true });
  await frame.evaluate(() => scrollTo(0, 0));
  await frame.locator('body').screenshot({ path: 'artifacts/pawchive-ripper-desktop.png' });
  await page.setViewportSize({ width: 360, height: 800 });
  await frame.evaluate(() => scrollTo(0, 0));
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await frame.locator('body').screenshot({ path: 'artifacts/pawchive-ripper-narrow.png' });
  console.log('PASS: missing partitioned originals fall back to the canonical thumbnail path; purple UI fits a narrow viewport.');
} finally {
  await context?.close();
  assert(output.startsWith(root + sep) && output.includes('.service-check-blocklist-'));
  await rm(output, { recursive: true, force: true });
}
