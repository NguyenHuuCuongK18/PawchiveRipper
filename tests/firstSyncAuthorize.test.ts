import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ offscreen: vi.fn(), release: vi.fn() }));
vi.mock('../src/background/offscreenBridge', () => mocks);
import { route } from '../src/services/router';
import { getLibrary, saveLibrary, type CreatorRecord } from '../src/services/posts/library';
import { deleteLocalRecords, getPostJob, getPostJobs, savePostJob } from '../src/storage/database';
import { defaultSelection } from '../src/services/posts/settings';
import type { PostJob } from '../src/services/posts/types';
const creator: CreatorRecord = { key: 'https://pawchive.pw/fanbox/123', source: { origin: 'https://pawchive.pw', platform: 'fanbox', creatorId: '123', postId: null }, creatorName: 'Creator', directoryId: 'child', folderName: 'fanbox_123_Creator', selection: defaultSelection(), enabled: true, checkedAt: 0, fullCheckedAt: 0, syncedAt: 0, nextCheckAt: 0, error: 'Folder access is required.' };
const sender = { id: 'extension', tab: { id: 1, url: 'chrome-extension://extension/folder/index.html#mode=first-sync' } } as chrome.runtime.MessageSender;
beforeEach(async () => {
  await deleteLocalRecords(); vi.resetAllMocks(); mocks.offscreen.mockResolvedValue({});
  vi.stubGlobal('fetch', vi.fn()); vi.stubGlobal('chrome', { runtime: { id: 'extension', getURL: (path: string) => `chrome-extension://extension/${path}` } });
  await saveLibrary({ enabled: true, creators: [structuredClone(creator)] });
});
afterEach(() => vi.unstubAllGlobals());
it('validates access without starting or resuming any downloads', async () => {
  const job: PostJob = { id: 'paused', source: creator.source, service: 'posts', automatic: true, creatorName: 'Creator', sourceUrl: creator.key, createdAt: '', updatedAt: '', status: 'paused', resumeStatus: 'scanning', selection: defaultSelection(), posts: [], tasks: [], detailQueue: [], archive: undefined, nextAt: 0, error: 'Folder access is required.', scan: { complete: false, offset: 0, pages: 0, total: null, error: null, attempts: 0, nextAt: 0, fingerprints: [] } };
  await savePostJob(job); const library = await getLibrary(); library.creators[0].runId = job.id; library.creators[0].nextCheckAt = 100000; await saveLibrary(library);
  expect(await route({ type: 'LIBRARY_FIRST_SYNC_ACCESS', key: creator.key }, sender)).toBe(true);
  expect(mocks.offscreen.mock.calls).toEqual([['post-folder-read', { directoryId: 'child', postJob: { source: creator.source } }]]);
  expect(await getPostJob(job.id)).toMatchObject({ status: 'paused', error: 'Folder access restored. Waiting for current work.' }); expect((await getLibrary()).creators[0].error).toBeUndefined(); expect((await getLibrary()).creators[0].nextCheckAt).toBe(0); expect(fetch).not.toHaveBeenCalled();
});
it.each(['synced', 'unselected', 'missing'])('does not authorize a %s creator', async kind => {
  const library = await getLibrary(); if (kind === 'synced') { library.creators[0].head = '[]'; library.creators[0].fullCheckedAt = 1; }
  if (kind === 'unselected') library.creators[0].enabled = false; if (kind === 'missing') library.creators = [];
  await saveLibrary(library); expect(await route({ type: 'LIBRARY_FIRST_SYNC_ACCESS', key: creator.key }, sender)).toBe(false); expect(mocks.offscreen).not.toHaveBeenCalled(); expect(await getPostJobs()).toEqual([]);
});
it('refuses authorization from the site overlay instead of the top-level folder page', async () => {
  await expect(route({ type: 'LIBRARY_FIRST_SYNC_ACCESS', key: creator.key }, { id: 'extension', tab: { id: 2, url: 'https://pawchive.pw/fanbox/user/123' } } as chrome.runtime.MessageSender)).rejects.toThrow('folder permission page'); expect(mocks.offscreen).not.toHaveBeenCalled();
});
it('retains the permission error if archive validation fails', async () => {
  mocks.offscreen.mockRejectedValue(new Error('Invalid sync.json.'));
  await expect(route({ type: 'LIBRARY_FIRST_SYNC_ACCESS', key: creator.key }, sender)).rejects.toThrow('Invalid');
  expect((await getLibrary()).creators[0].error).toBe('Folder access is required.'); expect(await getPostJobs()).toEqual([]);
});
