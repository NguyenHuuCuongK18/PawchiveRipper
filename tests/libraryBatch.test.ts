import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ offscreen: vi.fn(), release: vi.fn() }));
vi.mock('../src/background/offscreenBridge', () => mocks);
import { getLibrary, libraryStatus, saveLibrary, rememberCreator, setAutoSync, setLibraryMode, checkCreatorLibrary, completeLibraryRun, headFingerprint, CHECK_INTERVAL } from '../src/services/posts/library';
import { processLibraryBatch, queueLibraryBatch, selectLibraryCreators, stopLibraryBatch } from '../src/services/posts/libraryBatch';
import { deleteLocalRecords, getPostJobs, savePostJob } from '../src/storage/database';
import { defaultSelection } from '../src/services/posts/settings';
import { normalizePost } from '../src/services/posts/media';
import { emptySync } from '../src/services/posts/sync';
import type { PostJob } from '../src/services/posts/types';

function job(id = '123', origin = 'https://pawchive.pw'): PostJob {
  const source = { origin, platform: 'fanbox' as const, creatorId: id, postId: null };
  return { id: `manual-${id}`, service: 'posts', source, sourceUrl: `${origin}/fanbox/user/${id}`, creatorName: `Creator ${id}`, selection: defaultSelection(), destination: { kind: 'folder', directoryId: `saved-${id}`, name: `fanbox_${id}_Creator` }, posts: [], tasks: [], detailQueue: [], archive: undefined, resumeStatus: 'scanning', nextAt: 0, error: null, scan: { offset: 0, pages: 0, total: 0, complete: true, error: null, attempts: 0, nextAt: 0, fingerprints: [] }, createdAt: '', updatedAt: '', status: 'finished' };
}
const raw = (id: string) => ({ id: '100', user: id, service: 'fanbox', title: 'Post', content: 'text', published: '2026-01-01', attachments: [] });
async function register(id = '123', selected = true, origin?: string) {
  const record = job(id, origin); await rememberCreator(record);
  const key = `${record.source.origin}/fanbox/${id}`; await setAutoSync(selected, key); return key;
}
beforeEach(async () => {
  await deleteLocalRecords(); vi.resetAllMocks();
  vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([]) } });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify([raw(/\/user\/(\d+)/.exec(url)![1])]))));
  mocks.offscreen.mockImplementation(async (type, payload) => type === 'post-folder-read' ? emptySync({ ...job(), source: payload.postJob.source }) : undefined);
});
afterEach(() => vi.unstubAllGlobals());

it('queues only selected registered creators and rejects empty or invalid requests', async () => {
  await expect(queueLibraryBatch('check')).rejects.toThrow('Select');
  const key = await register(); await register('456', false);
  const batch = await queueLibraryBatch('check'); expect(batch.pending).toEqual([key]); expect(batch.total).toBe(1); expect(fetch).not.toHaveBeenCalled();
  await expect(queueLibraryBatch('sync')).rejects.toThrow('running');
  await expect(queueLibraryBatch('delete' as never)).rejects.toThrow('Check or Sync');
  await expect(selectLibraryCreators('yes' as never)).rejects.toThrow('Invalid');
});
it('checks with automatic mode off and no site tabs, without reading folders or saving files', async () => {
  await register(); await queueLibraryBatch('check'); await processLibraryBatch(100000);
  expect((await getLibrary()).enabled).toBe(false); expect((await getLibrary()).creators[0]).toMatchObject({ checkedAt: 100000, observation: 'initial_comparison' });
  expect((await libraryStatus()).batch).toMatchObject({ status: 'done', completed: 1, failed: 0 });
  expect(await getPostJobs()).toEqual([]); expect(mocks.offscreen).not.toHaveBeenCalled();
});
it('forces a full sync for unchanged recent posts, keeps deduplication, and does not change auto mode', async () => {
  await register(); const library = await getLibrary(), record = library.creators[0];
  record.head = await headFingerprint([normalizePost(raw('123') as never, record.source)]); record.fullCheckedAt = 100000; record.nextCheckAt = 100000 + CHECK_INTERVAL; await saveLibrary(library);
  await queueLibraryBatch('sync'); await processLibraryBatch(100001);
  const runs = await getPostJobs(); expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ automatic: true, libraryManual: true, status: 'scanning', selection: { keepArchives: true, deduplicate: true }, destination: { directoryId: 'saved-123' } });
  expect((await getLibrary()).enabled).toBe(false); expect(mocks.offscreen).toHaveBeenCalledWith('post-folder-read', expect.objectContaining({ directoryId: 'saved-123' }));
});
it('persists the active item and starts only one creator at a time', async () => {
  const first = await register(); const second = await register('456'); await queueLibraryBatch('sync');
  await processLibraryBatch(100000); const [run] = await getPostJobs(); await processLibraryBatch(100001);
  expect(await getPostJobs()).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(1);
  expect((await libraryStatus()).batch?.active).toEqual({ key: first, runId: run.id });
  run.status = 'finished'; await savePostJob(run); await completeLibraryRun(run); await processLibraryBatch(100002);
  const next = (await getPostJobs()).find(item => item.id !== run.id)!; expect(next.destination).toMatchObject({ kind: 'folder', directoryId: 'saved-456' });
  expect((await libraryStatus()).batch).toMatchObject({ completed: 1, active: { key: second, runId: next.id } });
  next.status = 'finished'; await savePostJob(next); await completeLibraryRun(next); await processLibraryBatch(100003);
  expect((await libraryStatus()).batch).toMatchObject({ status: 'done', completed: 2, failed: 0 });
});
it('waits for active manual work without pausing it', async () => {
  await register(); const manual = job('999'); manual.status = 'downloading'; await savePostJob(manual); await queueLibraryBatch('sync');
  await processLibraryBatch(100000); expect(fetch).not.toHaveBeenCalled(); expect(mocks.offscreen).not.toHaveBeenCalled();
  expect((await getPostJobs())[0].status).toBe('downloading');
  manual.status = 'finished'; await savePostJob(manual); await processLibraryBatch(100001); expect(await getPostJobs()).toHaveLength(2);
});
it('backs off a failed bulk API check without marking it successfully checked', async () => {
  await register(); await queueLibraryBatch('check'); vi.mocked(fetch).mockRejectedValue(new Error('Site unavailable.'));
  await processLibraryBatch(100000);
  expect((await getLibrary()).creators[0]).toMatchObject({ checkedAt: 0, nextCheckAt: 100000 + CHECK_INTERVAL, error: expect.any(String) });
  expect((await libraryStatus()).batch).toMatchObject({ status: 'done', failed: 1 }); expect(mocks.offscreen).not.toHaveBeenCalled();
});
it('skips a creator with denied access and continues with the next valid archive', async () => {
  await register(); await register('456'); await queueLibraryBatch('sync');
  mocks.offscreen.mockImplementation(async (_type, payload) => { if (payload.directoryId === 'saved-123') throw new Error('Folder access is required.'); return emptySync({ ...job('456'), source: payload.postJob.source }); });
  await processLibraryBatch(100000); expect(await getPostJobs()).toHaveLength(0);
  expect((await libraryStatus()).batch).toMatchObject({ completed: 1, failed: 1 });
  expect((await getLibrary()).creators.find(item => item.source.creatorId === '123')?.directoryId).toBe('saved-123');
  await processLibraryBatch(100001); expect((await getPostJobs())[0].source.creatorId).toBe('456');
});
it('stopping clears pending creators and pauses only the active batch job', async () => {
  await register(); await register('456'); await queueLibraryBatch('sync'); await processLibraryBatch(100000);
  const [active] = await getPostJobs(); const other = job('999'); other.status = 'downloading'; await savePostJob(other); mocks.offscreen.mockClear();
  await stopLibraryBatch(); await processLibraryBatch(100001);
  expect((await libraryStatus()).batch).toMatchObject({ status: 'stopped', pending: [], active: undefined });
  expect((await getPostJobs()).find(item => item.id === active.id)).toMatchObject({ status: 'paused', error: 'Batch stopped.' });
  expect((await getPostJobs()).find(item => item.id === other.id)?.status).toBe('downloading');
  expect(mocks.offscreen.mock.calls).toEqual([['post-transfer-stop', { jobId: active.id }]]); expect(fetch).toHaveBeenCalledTimes(1);
});
it('stops a queued batch before any network or folder access', async () => {
  await register(); await queueLibraryBatch('sync'); await stopLibraryBatch(); await processLibraryBatch();
  expect(fetch).not.toHaveBeenCalled(); expect(mocks.offscreen).not.toHaveBeenCalled(); expect(await getPostJobs()).toEqual([]);
});
it('keeps explicit bulk work separate from automatic mode and selection changes', async () => {
  await register(); await queueLibraryBatch('sync'); await processLibraryBatch(100000); mocks.offscreen.mockClear();
  await setLibraryMode('check'); await selectLibraryCreators(false);
  expect((await getPostJobs())[0].status).toBe('scanning'); expect(mocks.offscreen).not.toHaveBeenCalled();
  expect((await getLibrary()).creators[0].enabled).toBe(false);
});
it('resumes the existing paused library job instead of creating a duplicate scan', async () => {
  await register(); const paused = job(); paused.automatic = true; paused.status = 'paused'; paused.scan.complete = false; paused.autoDownload = defaultSelection(); paused.error = 'Folder access is required.'; await savePostJob(paused);
  const library = await getLibrary(); library.creators[0].runId = paused.id; await saveLibrary(library);
  await queueLibraryBatch('sync'); await processLibraryBatch(100000);
  expect(await getPostJobs()).toHaveLength(1); expect((await getPostJobs())[0]).toMatchObject({ id: paused.id, libraryManual: true, status: 'scanning' });
  expect((await libraryStatus()).batch?.active?.runId).toBe(paused.id); expect(fetch).not.toHaveBeenCalled();
});
it('respects host rate limits while allowing another website to progress', async () => {
  await register(); await register('456'); await register('789', true, 'https://kemono.cr'); await queueLibraryBatch('check');
  vi.mocked(fetch).mockImplementation(async (input) => String(input).includes('/user/123') ? new Response('', { status: 429, headers: { 'retry-after': '7200' } }) : new Response(JSON.stringify([raw(/\/user\/(\d+)/.exec(String(input))![1])])));
  await processLibraryBatch(100000); await processLibraryBatch(100001); const requests = vi.mocked(fetch).mock.calls.length;
  expect((await libraryStatus()).batch).toMatchObject({ completed: 2, failed: 1 });
  expect(await processLibraryBatch(100002)).toBe(30000); expect(fetch).toHaveBeenCalledTimes(requests);
  await processLibraryBatch(100000 + 7200001); expect((await libraryStatus()).batch).toMatchObject({ status: 'done', completed: 3, failed: 1 });
});
it('gives an explicit batch priority over scheduled checks and clears it with all extension data', async () => {
  await register(); await setLibraryMode('sync'); await queueLibraryBatch('check');
  await checkCreatorLibrary('https://pawchive.pw'); expect(fetch).not.toHaveBeenCalled();
  await deleteLocalRecords(); await processLibraryBatch(); expect((await libraryStatus()).batch).toBeUndefined(); expect(fetch).not.toHaveBeenCalled();
});
it('does not start a sync during an active ZIP save', async () => {
  await register(); const manual = job('999'); manual.archive = { state: 'saving', filename: 'manual.zip', blobUrl: 'blob:manual', downloadId: 1, bytes: 1, entries: 1, progress: 1, total: 1, error: null }; await savePostJob(manual);
  await queueLibraryBatch('sync'); await processLibraryBatch(); expect(fetch).not.toHaveBeenCalled();
});
it('selects and clears all registered creators without granting folder access', async () => {
  await register('123', false); await register('456', false); await selectLibraryCreators(true);
  expect((await getLibrary()).creators.every(item => item.enabled)).toBe(true);
  await selectLibraryCreators(false); expect((await getLibrary()).creators.every(item => !item.enabled)).toBe(true); expect(mocks.offscreen).not.toHaveBeenCalled();
});
