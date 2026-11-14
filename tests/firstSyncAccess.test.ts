/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getDirectory: vi.fn() }));
vi.mock('../src/storage/destination', () => mocks);
import { firstSyncPermissionQueue, requestFolderPermission } from '../src/folder/permissionQueue';
import { firstSyncAccess } from '../src/folder/firstSyncAccess';
import { needsFirstSyncAccess, type CreatorRecord } from '../src/services/posts/library';
import { emptySync } from '../src/services/posts/sync';
import { defaultSelection } from '../src/services/posts/settings';
import type { ArchiveDirectory } from '../src/storage/destination';

function fixture(id = '123') {
  const creator: CreatorRecord = { key: `https://pawchive.pw/fanbox/${id}`, source: { origin: 'https://pawchive.pw', platform: 'fanbox', creatorId: id, postId: null }, creatorName: `Creator ${id}`, directoryId: `folder-${id}`, folderName: `fanbox_${id}_Creator`, selection: defaultSelection(), enabled: true, checkedAt: 0, fullCheckedAt: 0, syncedAt: 0, nextCheckAt: 0 };
  let contents: string | undefined = JSON.stringify(emptySync(creator));
  const state = { read: 'granted' as PermissionState, write: 'prompt' as PermissionState, answer: 'granted' as PermissionState };
  const queryPermission = vi.fn(async ({ mode }: { mode: string }) => mode === 'read' ? state.read : state.write);
  const requestPermission = vi.fn(async () => { state.write = state.answer; return state.answer; });
  const getFileHandle = vi.fn(async (name: string) => {
    if (contents === undefined || name !== 'sync.json') throw new DOMException('Missing', 'NotFoundError');
    return { getFile: async () => ({ size: contents!.length, text: async () => contents! }) };
  });
  const handle = { kind: 'directory', name: creator.folderName, queryPermission, requestPermission, getFileHandle } as unknown as ArchiveDirectory;
  return { creator, handle, state, queryPermission, requestPermission, getFileHandle, removeIndex: () => { contents = undefined; }, breakIndex: () => { contents = '{broken'; } };
}
let folders: ReturnType<typeof fixture>[];
beforeEach(() => {
  vi.resetAllMocks(); folders = []; document.body.innerHTML = '<main></main>';
  mocks.getDirectory.mockImplementation(async id => folders.find(item => item.creator.directoryId === id)?.handle);
});
afterEach(() => vi.unstubAllGlobals());
const add = (id?: string) => { const value = fixture(id); folders.push(value); return value; };
const flush = async () => { await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('#permission-allow')?.disabled).toBe(false)); };

it('offers the button only for selected first-sync creators missing write permission', () => {
  const { creator } = add();
  expect(needsFirstSyncAccess(creator, 'prompt')).toBe(true); expect(needsFirstSyncAccess(creator, 'denied')).toBe(true);
  for (const access of ['granted', 'missing', 'unknown']) expect(needsFirstSyncAccess(creator, access)).toBe(false);
  expect(needsFirstSyncAccess({ ...creator, enabled: false }, 'prompt')).toBe(false);
  expect(needsFirstSyncAccess({ ...creator, head: '[]', fullCheckedAt: 1 }, 'prompt')).toBe(false);
});
it('preloads eligible child handles without requesting permission or browsing folders', async () => {
  const first = add(), granted = add('456'), synced = add('789'), unselected = add('900');
  granted.state.write = 'granted'; synced.creator.head = '[]'; synced.creator.fullCheckedAt = 1; unselected.creator.enabled = false;
  const result = await firstSyncPermissionQueue(folders.map(item => item.creator));
  expect(result.folders.map(item => item.creator.key)).toEqual([first.creator.key]); expect(result.issues).toEqual([]);
  for (const item of folders) expect(item.requestPermission).not.toHaveBeenCalled();
  expect(synced.queryPermission).not.toHaveBeenCalled(); expect(unselected.queryPermission).not.toHaveBeenCalled();
  expect(first.getFileHandle.mock.calls).toEqual([['sync.json']]);
});
it.each(['Archive', 'fanbox_456_Creator', 'patreon_123_Creator'])('refuses %s before reading metadata or requesting access', async name => {
  const value = add(); Object.assign(value.handle, { name });
  const result = await firstSyncPermissionQueue([value.creator]); expect(result.folders).toEqual([]); expect(result.issues).toHaveLength(1);
  expect(value.getFileHandle).not.toHaveBeenCalled(); expect(value.queryPermission).not.toHaveBeenCalled(); expect(value.requestPermission).not.toHaveBeenCalled();
});
it('skips disconnected handles and missing or malformed JSON before prompting when readable', async () => {
  const missing = add(), broken = add('456'), disconnected = add('789'); missing.removeIndex(); broken.breakIndex(); folders.pop();
  const result = await firstSyncPermissionQueue([missing.creator, broken.creator, disconnected.creator]); expect(result.folders).toHaveLength(0); expect(result.issues).toHaveLength(3);
  expect(missing.requestPermission).not.toHaveBeenCalled(); expect(broken.requestPermission).not.toHaveBeenCalled();
});
it('requests the prepared child handle synchronously to retain the click gesture', () => {
  const value = add(), calls: string[] = [];
  value.requestPermission.mockImplementation(() => { calls.push('prompt'); return Promise.resolve('granted'); });
  const pending = requestFolderPermission(value); calls.push('returned'); expect(calls).toEqual(['prompt', 'returned']);
  expect(value.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' }); return pending;
});
it('requires a separate click for each folder, automatically loading the next one', async () => {
  const first = add(), second = add('456'), confirm = vi.fn().mockResolvedValue(true);
  await firstSyncAccess(async () => ({ enabled: false, creators: folders.map(item => item.creator) }), confirm);
  expect(first.requestPermission).not.toHaveBeenCalled(); expect(second.requestPermission).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('#permission-allow')!.click();
  await vi.waitFor(() => expect(document.querySelector('#permission-creator')?.textContent).toBe(second.creator.creatorName));
  expect(confirm).toHaveBeenCalledWith(first.creator.key); expect(second.requestPermission).not.toHaveBeenCalled();
  await flush(); document.querySelector<HTMLButtonElement>('#permission-allow')!.click();
  await vi.waitFor(() => expect(document.querySelector('#permission-creator')?.textContent).toBe('Done'));
  expect(confirm.mock.calls).toEqual([[first.creator.key], [second.creator.key]]); expect(document.querySelector('#permission-progress')?.textContent).toBe('2 allowed · 0 skipped · 0 remaining');
});
it('keeps a denied folder available for retry and supports skipping without another request', async () => {
  const first = add(), second = add('456'), confirm = vi.fn(); first.state.answer = 'denied';
  await firstSyncAccess(async () => ({ enabled: false, creators: folders.map(item => item.creator) }), confirm);
  document.querySelector<HTMLButtonElement>('#permission-allow')!.click(); await flush();
  expect(document.querySelector('#permission-status')?.textContent).toBe('Not allowed. Try again or Skip.'); expect(confirm).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('#permission-skip')!.click();
  await vi.waitFor(() => expect(document.querySelector('#permission-creator')?.textContent).toBe(second.creator.creatorName));
  expect(first.requestPermission).toHaveBeenCalledTimes(1); expect(second.requestPermission).not.toHaveBeenCalled();
});
it('revalidates JSON after granting read access and never confirms an invalid archive', async () => {
  const value = add(), confirm = vi.fn(); value.state.read = 'prompt';
  await firstSyncAccess(async () => ({ enabled: false, creators: [value.creator] }), confirm); expect(value.getFileHandle).not.toHaveBeenCalled();
  value.breakIndex(); document.querySelector<HTMLButtonElement>('#permission-allow')!.click();
  await vi.waitFor(() => expect(document.querySelector('#permission-status')?.textContent).toBe('Invalid archive. Skipped.'));
  expect(confirm).not.toHaveBeenCalled(); expect(document.querySelector('#permission-progress')?.textContent).toBe('0 allowed · 1 skipped · 0 remaining');
});
it('does not prompt the next folder if it became allowed, synced, or unselected', async () => {
  const first = add(), granted = add('456'), synced = add('789'), unselected = add('900');
  await firstSyncAccess(async () => ({ enabled: false, creators: folders.map(item => item.creator) }), vi.fn().mockImplementation(async () => { granted.state.write = 'granted'; synced.creator.head = '[]'; synced.creator.fullCheckedAt = 1; unselected.creator.enabled = false; }));
  document.querySelector<HTMLButtonElement>('#permission-allow')!.click();
  await vi.waitFor(() => expect(document.querySelector('#permission-creator')?.textContent).toBe('Done'));
  expect(first.requestPermission).toHaveBeenCalledTimes(1); for (const item of [granted, synced, unselected]) expect(item.requestPermission).not.toHaveBeenCalled();
});
it('handles a cancelled browser prompt without advancing or retrying automatically', async () => {
  const value = add(), confirm = vi.fn(); value.requestPermission.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  await firstSyncAccess(async () => ({ enabled: false, creators: [value.creator] }), confirm); document.querySelector<HTMLButtonElement>('#permission-allow')!.click(); await flush();
  expect(document.querySelector('#permission-status')?.textContent).toBe('Cancelled. Try again or Skip.'); expect(confirm).not.toHaveBeenCalled(); expect(value.requestPermission).toHaveBeenCalledTimes(1);
});
