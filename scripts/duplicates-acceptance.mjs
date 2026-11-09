import { chromium } from 'playwright';
import { BlobWriter, Uint8ArrayReader, ZipWriter, ZipReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.'), output = resolve(`.service-check-duplicates-${Date.now()}`);
assert(output.startsWith(root + sep)); await mkdir(output);
const source = 'https://pawchive.pw/fanbox/user/540245';
const path = (letter, ext) => `/2${letter.repeat(2)}/bb/${letter.repeat(64)}.${ext}`;
const image = await readFile('tests/fixtures/test-image.jpg');
const imagePath = path('a', 'png'), zipAPath = path('b', 'zip'), zipBPath = path('c', 'zip'), zipCPath = path('d', 'zip');
async function archive(files) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [name, bytes] of files) await writer.add(name, new Uint8ArrayReader(bytes));
  return [...new Uint8Array(await (await writer.close()).arrayBuffer())];
}
const encode = value => new TextEncoder().encode(value);
const zipA = await archive([['page.png', image], ['story.txt', encode('EN')], ['common.bin', encode('Shared archive content')]]);
const zipB = await archive([['renamed/page.png', image], ['story.txt', encode('ZH')], ['common.bin', encode('Shared archive content')], ['nested-original.zip', new Uint8Array(zipA)]]);
const zipC = await archive([['unused.txt', encode('Excluded by the user')]]);
const attachment = (name, path, node = 1) => ({ name, path, server: `https://n${node}.pawchive.pw` });
const base = { user: '540245', service: 'fanbox', content: 'Post text', has_full: true, detail_fetched: true, published: '2026-11-01T00:00:00' };
const posts = [
  { ...base, id: '100', title: 'Original post', file: attachment('cover.png', imagePath), attachments: [attachment('original-en-jp.zip', zipAPath)] },
  { ...base, id: '200', title: 'Monthly recap', file: attachment('recap.png', imagePath.replace('/2aa/', '/1aa/'), 2), attachments: [attachment('repeated-original.zip', zipAPath, 2), attachment('monthly-ZH.zip', zipBPath), attachment('unused.zip', zipCPath)] },
];
const laterPost = { ...base, id: '300', title: 'Later repeated archive', file: {}, attachments: [attachment('later-copy.zip', zipAPath)] };
let context, diagnostic = async () => ({});
async function waitFor(work) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { const value = await work(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error('Duplicate acceptance timed out: ' + JSON.stringify(await diagnostic()));
}
try {
  context = await chromium.launchPersistentContext(resolve(output, 'profile'), { channel: 'chromium', headless: true, acceptDownloads: true,
    viewport: { width: 1280, height: 1000 }, args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(), cdp = await context.newCDPSession(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
  await context.route('https://**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Recap fixture</title><div class="paginator">Showing 1 - 2 of 2</div>' }));
  await worker.evaluate(({ posts, laterPost }) => {
    const nativeFetch = fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input)); if (!url.pathname.startsWith('/api/v1/')) return nativeFetch(input, init);
      if (url.pathname.endsWith('/profile')) return new Response(JSON.stringify({ id: '540245', name: 'Recap fixture' }));
      if (url.pathname.includes('/post/')) return new Response(JSON.stringify([...posts, laterPost].find(post => url.pathname.endsWith('/' + post.id))));
      return new Response(JSON.stringify(Number(url.searchParams.get('o')) === 0 ? posts : []));
    };
    const download = chrome.downloads.download.bind(chrome.downloads);
    chrome.downloads.download = options => download({ ...options, saveAs: false });
  }, { posts, laterPost });
  await page.goto(source);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, source);
  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_OVERLAY' }), tabId);
  const frame = await waitFor(() => page.frames().find(frame => frame.url().includes('/overlay/index.html')));
  const send = message => frame.evaluate(async message => { const reply = await chrome.runtime.sendMessage(message); if (!reply.ok) throw new Error(reply.error); return reply.data; }, message);
  let jobId = await waitFor(async () => (await send({ type: 'SERVICE_JOBS' }))[0]?.id);
  const detail = () => send({ type: 'POST_DETAIL', jobId });
  diagnostic = async () => ({ view: await detail(), notice: await frame.locator('#notice').textContent() });
  await waitFor(async () => (await detail()).job.scan.complete);
  await frame.locator('#archive-choices summary').click();
  await waitFor(async () => await frame.locator('#archive-rows input').count() === 4);
  assert.equal(await frame.locator('#deduplicate').isChecked(), true);
  await frame.locator('#archive-search').fill('ZH');
  assert.equal(await frame.locator('#archive-rows input').count(), 1);
  assert.equal(await frame.locator('#archive-rows input').isChecked(), true);
  await frame.locator('#archive-search').fill('');
  await frame.locator('#archive-rows label').filter({ hasText: 'unused.zip' }).locator('input').uncheck();
  assert.equal(await frame.locator('#archive-count').textContent(), '3/4 archives selected');
  await frame.locator('#extract-archives').check(); await frame.locator('#destination-zip').check();
  await worker.evaluate(async () => { if (!(await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length)
    await chrome.offscreen.createDocument({ url: 'offscreen/index.html', reasons: [chrome.offscreen.Reason.BLOBS], justification: 'Verify duplicate handling.' }); });
  const offscreenUrl = new URL('/offscreen/index.html', worker.url()).href;
  async function evaluate(expression) {
    const target = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.url === offscreenUrl); assert(target);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    try {
      const result = new Promise((resolve, reject) => {
        const listener = event => { if (event.sessionId !== sessionId) return; const message = JSON.parse(event.message); if (message.id !== 1) return;
          cdp.off('Target.receivedMessageFromTarget', listener); if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message))); else resolve(message.result.result?.value); };
        cdp.on('Target.receivedMessageFromTarget', listener);
      });
      await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }) });
      return await result;
    } finally { await cdp.send('Target.detachFromTarget', { sessionId }); }
  }
  const media = [{ path: imagePath, bytes: [...image] }, { path: imagePath.replace('/2aa/', '/1aa/'), bytes: [...image] }, { path: zipAPath, bytes: zipA }, { path: zipBPath, bytes: zipB }, { path: zipCPath, bytes: zipC }];
  await evaluate(`(()=>{const media=${JSON.stringify(media)},nativeFetch=fetch;globalThis.__mediaRequests=[];globalThis.fetch=async(input,init)=>{const url=new URL(String(input));if(url.protocol!=='https:')return nativeFetch(input,init);globalThis.__mediaRequests.push(url.pathname);const entry=media.find(entry=>url.pathname==='/data'+entry.path);return entry?new Response(new Uint8Array(entry.bytes),{headers:{'content-type':entry.path.endsWith('.png')?'image/png':'application/octet-stream'}}):new Response('',{status:404});};return true;})()`);
  const requestCount = () => evaluate('globalThis.__mediaRequests.length');
  async function exported() {
    const [download] = await worker.evaluate(() => chrome.downloads.search({ orderBy: ['-startTime'] }));
    const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(await readFile(download.filename))), { useWebWorkers: false });
    try { return await Promise.all((await reader.getEntries()).map(async entry => ({ path: entry.filename, bytes: [...await entry.getData(new Uint8ArrayWriter())] }))); }
    finally { await reader.close(); }
  }
  await frame.locator('#download').click();
  await waitFor(async () => (await detail()).job.archive?.state === 'saved');
  const selection = (await detail()).job.selection, entries = await exported();
  assert.equal(await requestCount(), 3);
  const json = name => JSON.parse(new TextDecoder().decode(new Uint8Array(entries.find(entry => entry.path.endsWith('/' + name)).bytes)));
  const duplicates = json('duplicates.json'); assert.equal(duplicates.length, 5); assert(duplicates.every(entry => entry.status === 'saved'));
  const story = entries.filter(entry => entry.path.endsWith('/story.txt')).map(entry => new TextDecoder().decode(new Uint8Array(entry.bytes))).sort();
  assert.deepEqual(story, ['EN', 'ZH']);
  assert.equal(entries.filter(entry => entry.bytes.length === image.length && entry.bytes.every((byte, i) => byte === image[i])).length, 1);
  assert.equal(entries.filter(entry => entry.path.endsWith('/common.bin')).length, 1);
  assert(!entries.some(entry => /_(?:original-en-jp|monthly-ZH|repeated-original)\.zip$/.test(entry.path)));
  assert.deepEqual(entries.find(entry => entry.path.endsWith('/nested-original.zip')).bytes, zipA);
  assert.equal((await detail()).duplicates, 5);
  console.log('PASS: UI excludes an archive before transfer; repeated ZIP/image attachments download once; extracted bytes share one copy while EN/ZH versions remain.');

  const extracted = entries.map(entry => ({ ...entry, path: entry.path.split('/').slice(1).join('/') }));
  await evaluate(`(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('duplicate-folder',{create:true});for(const entry of ${JSON.stringify(extracted)}){const parts=entry.path.split('/');let dir=root;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});const out=await(await dir.getFileHandle(parts.at(-1),{create:true})).createWritable();await out.write(new Uint8Array(entry.bytes));await out.close();}const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kemono-archive-destinations',1);r.onupgradeneeded=()=>r.result.createObjectStore('folders');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction('folders','readwrite');tx.objectStore('folders').put(root,'duplicate-folder');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();return true;})()`);
  await send({ type: 'POST_FOLDER', jobId, directoryId: 'duplicate-folder', name: 'Duplicate fixture' });
  await send({ type: 'POST_DOWNLOAD', jobId, selection, destination: 'folder' });
  await waitFor(async () => (await detail()).job.status === 'finished');
  assert.equal(await requestCount(), 3);
  console.log('PASS: exported shared-file references reconnect through sync.json and unchanged folder sync makes no media requests.');

  const originalStory = extracted.find(entry => entry.path.includes('100_') && entry.path.endsWith('/story.txt')).path;
  await evaluate(`(async()=>{let dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('duplicate-folder');const parts=${JSON.stringify(originalStory)}.split('/');for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);await dir.removeEntry(parts.at(-1));return true;})()`);
  await send({ type: 'POST_DOWNLOAD', jobId, selection, destination: 'folder' });
  await waitFor(async () => (await detail()).job.status === 'finished');
  assert.equal(await requestCount(), 4);
  assert.equal((await detail()).totals.extractionFailures, 0);
  console.log('PASS: deleting a unique extracted output fetches only its source archive and rebuilds valid shared references.');

  const sharedImage = extracted.find(entry => /_cover\.(?:jpg|png)$/.test(entry.path)).path;
  await evaluate(`(async()=>{let dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('duplicate-folder');const parts=${JSON.stringify(sharedImage)}.split('/');for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);await dir.removeEntry(parts.at(-1));return true;})()`);
  await send({ type: 'POST_DOWNLOAD', jobId, selection, destination: 'folder' });
  await waitFor(async () => (await detail()).job.status === 'finished');
  assert.equal(await requestCount(), 7);
  assert.equal((await detail()).duplicates, 5);
  assert.equal((await detail()).totals.extractionFailures, 0);
  console.log('PASS: deleting the shared image recovers it and both dependent archives without dangling references.');

  jobId = (await send({ type: 'POST_START', url: source + '/post/300' })).jobId;
  await waitFor(async () => (await detail()).job.scan.complete);
  await send({ type: 'POST_FOLDER', jobId, directoryId: 'duplicate-folder', name: 'Duplicate fixture' });
  await send({ type: 'POST_DOWNLOAD', jobId, selection: { ...selection, text: false }, destination: 'folder' });
  await waitFor(async () => (await detail()).job.status === 'finished');
  assert.equal(await requestCount(), 7); assert.equal((await detail()).duplicates, 1);
  console.log('PASS: a later single-post job reuses an identical archive already represented by extracted folder contents.');

  jobId = (await send({ type: 'POST_START', url: source + '/post/100' })).jobId;
  await waitFor(async () => (await detail()).job.scan.complete);
  await send({ type: 'POST_DOWNLOAD', jobId, selection: { ...selection, deduplicate: false }, destination: 'zip' });
  await waitFor(async () => (await detail()).job.archive?.state === 'saved');
  const keepAll = await exported();
  assert.equal(keepAll.filter(entry => entry.bytes.length === image.length && entry.bytes.every((byte, i) => byte === image[i])).length, 2);
  assert.deepEqual(errors, []);
  await mkdir('artifacts', { recursive: true });
  await frame.evaluate(() => { document.querySelector('#archive-choices').open = true; scrollTo(0, 300); });
  await frame.locator('body').screenshot({ path: 'artifacts/pawchive-ripper-duplicates.png' });
  console.log('PASS: disabling duplicate handling preserves separate copies; browser reports no page errors.');
} finally {
  await context?.close(); assert(output.startsWith(root + sep) && output.includes('.service-check-duplicates-'));
  await rm(output, { recursive: true, force: true });
}
