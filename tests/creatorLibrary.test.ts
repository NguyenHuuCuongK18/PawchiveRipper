import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ offscreen: vi.fn(), release: vi.fn() }));
vi.mock('../src/background/offscreenBridge', () => mocks);
import { getLibrary, libraryStatus, saveLibrary, rememberCreator, setAutoSync, setLibraryMode, checkCreatorLibrary, completeLibraryRun, headFingerprint, FULL_INTERVAL, CHECK_INTERVAL } from '../src/services/posts/library';
import { deleteLocalRecords, getPostJobs, savePostJob } from '../src/storage/database';
import { defaultSelection } from '../src/services/posts/settings';
import { normalizePost } from '../src/services/posts/media';
import { emptySync } from '../src/services/posts/sync';
import type { PostJob } from '../src/services/posts/types';
const source = { origin: 'https://pawchive.pw', platform: 'fanbox' as const, creatorId: '123', postId: null };
const raw = { id: '100', user: '123', service: 'fanbox', title: 'Post', content: 'old', published: '2026-01-01', attachments: [] };
function job(): PostJob { return { id: 'manual', service: 'posts', source, sourceUrl: source.origin + '/fanbox/user/123', creatorName: 'Creator', selection: defaultSelection(), destination: { kind: 'folder', directoryId: 'saved', name: 'fanbox_123_Creator' }, posts: [], tasks: [], detailQueue: [], archive: undefined, resumeStatus: 'scanning', nextAt: 0, error: null, scan: { offset: 0, pages: 0, total: 0, complete: true, error: null, attempts: 0, nextAt: 0, fingerprints: [] }, createdAt: '', updatedAt: '', status: 'finished' }; }
beforeEach(async () => { await deleteLocalRecords(); vi.resetAllMocks(); vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([{ id: 1 }]) } }); vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify([raw])))); mocks.offscreen.mockResolvedValue(emptySync(job())); });
afterEach(() => vi.unstubAllGlobals());
async function enabled() { await rememberCreator(job()); const library = await getLibrary(); library.enabled = library.creators[0].enabled = true; await saveLibrary(library); }
it('defaults off and retains a creator connection independently of job history', async () => { await rememberCreator(job()); expect((await getLibrary()).enabled).toBe(false); expect((await getLibrary()).creators[0]).toMatchObject({ directoryId: 'saved', enabled: false }); expect(await getPostJobs()).toEqual([]); });
it('does no network or folder access when disabled, even if a tracked site opens', async () => { await rememberCreator(job()); await checkCreatorLibrary(source.origin); expect(fetch).not.toHaveBeenCalled(); expect(mocks.offscreen).not.toHaveBeenCalled(); });
it('does not broaden single-post subscriptions or narrow full-creator subscriptions on another post', async () => {
  const single = job(); single.source = { ...source, postId: '100' }; await rememberCreator(single); expect((await getLibrary()).creators[0].source.postId).toBe('100');
  await rememberCreator(job()); await rememberCreator(single); expect((await getLibrary()).creators[0].source.postId).toBeNull();
});
it('starts one durable automatic run and keeps originals and duplicate preferences', async () => {
  await enabled(); await checkCreatorLibrary(source.origin, 100000); await checkCreatorLibrary(source.origin, 100001);
  expect(fetch).toHaveBeenCalledTimes(1); const runs = await getPostJobs(); expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ automatic: true, status: 'scanning', selection: { keepArchives: true, deduplicate: true }, destination: { directoryId: 'saved' } }); expect((await getLibrary()).creators[0].runId).toBe(runs[0].id);
});
it('skips unchanged recent metadata and still performs a full scan once the weekly deadline passes', async () => {
  await enabled(); const now = FULL_INTERVAL * 2, library = await getLibrary(); library.creators[0].head = await headFingerprint([normalizePost(raw as never, source)]); library.creators[0].fullCheckedAt = now; await saveLibrary(library);
  await checkCreatorLibrary(source.origin, now); expect(await getPostJobs()).toHaveLength(0); expect(mocks.offscreen).not.toHaveBeenCalled();
  await checkCreatorLibrary(source.origin, now + FULL_INTERVAL + 1); expect(await getPostJobs()).toHaveLength(1);
});
it('detects edited text even when the newest post ID has not changed', async () => {
  await enabled(); const library = await getLibrary(); library.creators[0].head = await headFingerprint([normalizePost({ ...raw, content: 'changed' } as never, source)]); library.creators[0].fullCheckedAt = 100000; await saveLibrary(library);
  await checkCreatorLibrary(source.origin, 100001); expect(await getPostJobs()).toHaveLength(1);
});
it('waits behind manual work without pausing it or making a probe', async () => { await enabled(); const manual = job(); manual.status = 'downloading'; await savePostJob(manual); await checkCreatorLibrary(source.origin); expect(fetch).not.toHaveBeenCalled(); expect((await getPostJobs())[0].status).toBe('downloading'); });
it('remembers a denied connection and queues no downloads', async () => { await enabled(); mocks.offscreen.mockRejectedValue(new Error('Folder access is required.')); await checkCreatorLibrary(source.origin, 100000); const record = (await getLibrary()).creators[0]; expect(record.directoryId).toBe('saved'); expect(record.error).toContain('Folder access'); expect(record.nextCheckAt).toBe(100000 + CHECK_INTERVAL); expect(await getPostJobs()).toHaveLength(0); });
it('does not mark failed API checks as successfully checked', async () => { await enabled(); vi.mocked(fetch).mockResolvedValue(new Response('', { status: 429 })); await checkCreatorLibrary(source.origin, 100000); expect((await getLibrary()).creators[0]).toMatchObject({ checkedAt: 0, directoryId: 'saved' }); expect(await getPostJobs()).toHaveLength(0); });
it('turning off auto sync pauses its run without dropping its archive connection', async () => { await enabled(); await checkCreatorLibrary(source.origin, 100000); await setAutoSync(false); expect((await getPostJobs())[0]).toMatchObject({ status: 'paused', error: 'Automatic sync is off.' }); expect((await getLibrary()).creators[0].directoryId).toBe('saved'); });
it('check-only mode reports a missing baseline without claiming that an imported archive has updates', async () => {
  await enabled(); const library = await getLibrary(); library.checkOnly = true; await saveLibrary(library);
  await checkCreatorLibrary(source.origin, 100000); expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.offscreen).not.toHaveBeenCalled();
  expect(await getPostJobs()).toHaveLength(0); expect((await getLibrary()).creators[0]).toMatchObject({ observation: 'initial_comparison', checkedAt: 100000 }); expect((await getLibrary()).creators[0].error).toBeUndefined();
});
it.each([
  ['recent_changed', { ...raw, content: 'New revision' }, 1, []],
  ['recent_unchanged', raw, 1, []],
  ['weekly_due', raw, FULL_INTERVAL + 1, []],
  ['incomplete', raw, 1, [{ ...raw, id: 'invalid' }]]
] as const)('check-only mode distinguishes %s without touching the archive', async (result, response, elapsed, extra) => {
  await enabled(); const library = await getLibrary(), now = FULL_INTERVAL * 2;
  library.checkOnly = true; library.creators[0].head = await headFingerprint([normalizePost(raw as never, source)]); library.creators[0].fullCheckedAt = now; await saveLibrary(library);
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify([response, ...extra])));
  await checkCreatorLibrary(source.origin, now + elapsed);
  expect((await getLibrary()).creators[0]).toMatchObject({ observation: result, checkedAt: now + elapsed });
  expect((await getLibrary()).creators[0].error).toBeUndefined(); expect(await getPostJobs()).toHaveLength(0); expect(mocks.offscreen).not.toHaveBeenCalled();
});
it('migrates the old ambiguous notice without inventing evidence of a recent change', async () => {
  await enabled(); const library = await getLibrary(); library.creators[0].error = 'Updates or a full check are due. Turn off check-only mode to save them.'; library.creators[0].checkedAt = 100; await saveLibrary(library);
  expect((await getLibrary()).creators[0]).toMatchObject({ observation: 'initial_comparison', checkedAt: 100 }); expect((await getLibrary()).creators[0].error).toBeUndefined();
  library.creators[0].head = 'existing'; library.creators[0].fullCheckedAt = 100; await saveLibrary(library);
  expect((await getLibrary()).creators[0].observation).toBe('comparison_due');
});
it('changes mode atomically, pauses saving in check-only mode, and keeps real errors and connections', async () => {
  await enabled(); await checkCreatorLibrary(source.origin, 100000);
  const library = await getLibrary(); library.creators[0].error = 'Site request failed.'; await saveLibrary(library);
  expect(await setLibraryMode('check')).toMatchObject({ enabled: true, checkOnly: true });
  expect((await getPostJobs())[0].status).toBe('paused');
  expect((await getLibrary()).creators[0]).toMatchObject({ error: 'Site request failed.', directoryId: 'saved', nextCheckAt: 0 });
  expect(await setLibraryMode('off')).toMatchObject({ enabled: false, checkOnly: false });
  expect(await setLibraryMode('sync')).toMatchObject({ enabled: true, checkOnly: false });
  await expect(setLibraryMode('bad' as never)).rejects.toThrow('Choose Off');
});
it('returns current automatic-run state without embedding its posts and tasks in library status', async () => {
  await enabled(); await checkCreatorLibrary(source.origin, 100000); const automatic = (await getPostJobs())[0]; automatic.status = 'paused'; automatic.error = 'Folder access is required.'; await savePostJob(automatic);
  const status = await libraryStatus(); expect(status.runs).toEqual({ [automatic.id]: { status: 'paused', error: automatic.error } });
  expect(await getLibrary()).not.toHaveProperty('runs');
});
it('keeps source website identity separate from a similarly numbered creator on another site', async () => {
  await rememberCreator(job()); const other = job(); other.source = { ...source, origin: 'https://kemono.cr' }; other.destination = { kind: 'folder', directoryId: 'other', name: 'fanbox_123_Creator' }; await rememberCreator(other);
  expect((await getLibrary()).creators).toHaveLength(2);
});
it('does not confuse hydrated detail with a changed recent-list response', async () => {
  await enabled(); const now = Date.now(); await checkCreatorLibrary(source.origin, now);
  const run = (await getPostJobs())[0]; run.status = 'finished'; run.scan.complete = true; run.posts = [normalizePost({ ...raw, content: 'Hydrated detail not supplied by the list endpoint' } as never, source)];
  await savePostJob(run); await completeLibraryRun(run); mocks.offscreen.mockClear();
  await checkCreatorLibrary(source.origin, now + CHECK_INTERVAL + 1);
  expect(await getPostJobs()).toHaveLength(1); expect(mocks.offscreen).not.toHaveBeenCalled();
});
it('queues tolerant discovery when a quick page contains one invalid record', async () => {
  await enabled(); vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify([raw, { ...raw, id: 'invalid' }])));
  await checkCreatorLibrary(source.origin, 100000); expect(await getPostJobs()).toHaveLength(1);
});
it('waits while a finished manual job is still saving its ZIP', async () => {
  await enabled(); const manual = job(); manual.archive = { state: 'saving', filename: 'manual.zip', blobUrl: 'blob:manual', downloadId: 1, bytes: 1, entries: 1, progress: 1, total: 1, error: null };
  await savePostJob(manual); await checkCreatorLibrary(source.origin); expect(fetch).not.toHaveBeenCalled();
});
it('backs off a failed paused-run restore rather than blocking every other creator', async () => {
  await enabled(); const paused = job(); paused.automatic = true; paused.status = 'paused'; paused.error = 'Automatic sync is off.'; paused.autoDownload = defaultSelection(); await savePostJob(paused);
  const library = await getLibrary(); library.creators[0].runId = paused.id; await saveLibrary(library); mocks.offscreen.mockRejectedValue(new Error('Folder access is required.'));
  await checkCreatorLibrary(source.origin, 100000); expect((await getLibrary()).creators[0]).toMatchObject({ nextCheckAt: 100000 + CHECK_INTERVAL, error: 'Folder access is required.' });
  expect(fetch).not.toHaveBeenCalled();
});
it('shares an API Retry-After cooldown across creators on the same website', async () => {
  await enabled(); const other = job(); other.source = { ...source, creatorId: '456' }; other.destination = { kind: 'folder', directoryId: 'other', name: 'fanbox_456_Other' }; await rememberCreator(other);
  const library = await getLibrary(); library.creators.forEach(item => { item.enabled = true; }); await saveLibrary(library);
  vi.mocked(fetch).mockImplementation(async () => new Response('', { status: 429, headers: { 'retry-after': '7200' } }));
  await checkCreatorLibrary(source.origin, 100000); await checkCreatorLibrary(source.origin, 100001); expect(fetch).toHaveBeenCalledTimes(1);
  expect((await getLibrary()).creators[0].nextCheckAt).toBe(100000 + 7200000);
});
