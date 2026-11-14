import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ requireDirectory: vi.fn(), stagedFile: vi.fn(), createArchive: vi.fn() }));
vi.mock('../src/storage/destination', async original => ({ ...await original<typeof import('../src/storage/destination')>(), requireDirectory: mocks.requireDirectory }));
vi.mock('../src/storage/zipCache', () => ({ stagedFile: mocks.stagedFile, createArchive: mocks.createArchive, removeStagedFile: vi.fn() }));
import { checkFolder, folderSync, writePostFile, writePostIndex } from '../src/services/posts/folder';
import { createTasks, normalizePost } from '../src/services/posts/media';
import { removeExtractedArchive } from '../src/services/posts/extraction';
import { buildPostZip } from '../src/services/posts/zip';
import { emptySync, recordSaved } from '../src/services/posts/sync';
import { contentDigest } from '../src/services/posts/creatorSafety';
const sourceDigest = await contentDigest(new Blob(['original'])), outputDigest = await contentDigest(new Blob(['content']));
import { archiveSettings, defaultSelection } from '../src/services/posts/settings';
import type { PostJob, PostTask } from '../src/services/posts/types';

const files = new Map<string, Blob>(), events: string[] = [];
const rejectedNames = new Set<string>();
let failIndex = false;
function directory(prefix = ''): FileSystemDirectoryHandle {
  return {
    name: prefix ? prefix.split('/').filter(Boolean).at(-1) : 'fanbox_123_Creator', __prefix: prefix,
    resolve: async (entry: { __prefix: string }) => entry.__prefix.startsWith(prefix) ? entry.__prefix.slice(prefix.length).split('/').filter(Boolean) : null,
    getDirectoryHandle: async (name: string) => {
      if (rejectedNames.has(name)) throw new TypeError("Failed to execute 'getDirectoryHandle' on 'FileSystemDirectoryHandle': Name is not allowed.");
      return directory(prefix + name + '/');
    },
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (rejectedNames.has(name)) throw new TypeError("Failed to execute 'getFileHandle' on 'FileSystemDirectoryHandle': Name is not allowed.");
      const path = prefix + name;
      if (!options?.create && !files.has(path)) throw new DOMException('Missing', 'NotFoundError');
      return { getFile: async () => files.get(path), createWritable: async () => {
        let pending: Blob;
        return { write: async (blob: Blob) => { pending = blob; }, close: async () => {
          if (failIndex && path === 'sync.json') throw new Error('Disk full');
          files.set(path, pending); events.push('write:' + path);
        }, abort: async () => {} };
      } };
    },
    removeEntry: async (name: string) => { const path = prefix + name; if (!files.delete(path)) throw new DOMException('Missing', 'NotFoundError'); events.push('remove:' + path); },
  } as unknown as FileSystemDirectoryHandle;
}
function job(): PostJob {
  const task: PostTask = { id: '100:full res:/aa/bb/' + 'a'.repeat(64) + '.zip', postId: '100', quality: 'full res', kind: 'file', url: null, path: 'full res/100_Title/001_bundle.zip', status: 'downloaded', bytes: 8, attempts: 1, nextAt: 0, error: null,
    extraction: { state: 'done', sourceDigest, files: [] } };
  task.extraction!.files = [{ id: task.id + ':extract:1', path: task.path + '.extracted/nested/file.txt', bytes: 7, digest: outputDigest }];
  const value = { id: 'archive-saving', source: { origin: 'https://pawchive.pw', platform: 'fanbox', creatorId: '123', postId: null }, sourceUrl: 'https://pawchive.pw/fanbox/user/123', creatorName: 'Creator', selection: { ...defaultSelection(), extractArchives: true }, posts: [{ id: '100', title: 'Title' }], scan: { complete: true }, tasks: [task], destination: { kind: 'folder', directoryId: 'folder', name: 'Creator' } } as PostJob;
  value.sync = emptySync(value); recordSaved(value.sync, task, 'Title');
  files.set(task.path, new Blob(['original'])); files.set(task.extraction!.files[0].path, new Blob(['content']));
  files.set('sync.json', new Blob([JSON.stringify(value.sync)]));
  return value;
}
const json = (value: unknown) => new Blob([JSON.stringify(value)]);
beforeEach(() => { files.clear(); rejectedNames.clear(); events.length = 0; failIndex = false; vi.resetAllMocks(); mocks.requireDirectory.mockResolvedValue(directory()); });
describe('settings migration and extracted archive saving', () => {
  it.each(['folder', 'file'])('recovers a rejected legacy %s name without aborting sync or losing other saved files', async rejected => {
    const value = job();
    value.selection = { ...defaultSelection(), images: false, files: false, text: true };
    value.posts = ['100', '101'].map(id => normalizePost({ id, user: value.source.creatorId, service: value.source.platform, title: id === '100' ? '🐈\u200d⬛👓' : 'Saved post', published: '2024-11-03T00:00:00' }, value.source));
    value.tasks = createTasks(value, value.selection);
    value.sync = emptySync(value);
    const legacyPath = rejected === 'folder' ? value.tasks[0].path.replace('🐈_⬛👓', '🐈\u200d⬛👓') : value.tasks[0].path.replace('post.txt', 'po\u200dst.txt');
    rejectedNames.add(legacyPath.split('/')[rejected === 'folder' ? 1 : 2]);
    for (const [index, task] of value.tasks.entries()) {
      const saved = { ...task, path: index === 0 ? legacyPath : task.path, status: 'downloaded' as const, bytes: 7 };
      files.set(saved.path, new Blob(['content'])); recordSaved(value.sync, saved, 'Title');
    }
    files.set('sync.json', json(value.sync));
    const checked = await checkFolder(value);
    expect(checked.files.map(file => file.id)).toEqual([value.tasks[1].id]);
    expect(checked.sync!.posts[0].files[0].path).toBe(legacyPath);
    expect(value.tasks[0].path).not.toBe(legacyPath);
    expect(value.tasks[0].status).toBe('queued');

    value.sync = checked.sync;
    const task = value.tasks[0]; task.status = 'staged'; task.bytes = 7;
    mocks.stagedFile.mockResolvedValue(new Blob(['content']));
    Object.assign(task, await writePostFile(value, task.id), { status: 'downloaded' });
    recordSaved(value.sync!, task, value.posts[0].title);
    await writePostIndex(value);
    expect((await checkFolder(value)).files).toHaveLength(2);
    expect(JSON.parse(await files.get('sync.json')!.text()).posts[0].files[0].path).toBe(task.path);
    expect(files.has(legacyPath)).toBe(true);
    expect(events.some(event => event.startsWith('remove:'))).toBe(false);
  });
  it('still reports permission and unrelated lookup errors while checking saved paths', async () => {
    const value = job(); files.set('sync.json', json(value.sync));
    const folder = directory();
    for (const error of [new DOMException('Permission denied', 'NotAllowedError'), new TypeError('Unexpected lookup failure')]) {
      mocks.requireDirectory.mockResolvedValue({ ...folder, getDirectoryHandle: vi.fn().mockRejectedValue(error) });
      await expect(checkFolder(value)).rejects.toBe(error);
    }
  });
  it('reads old history with default type/extraction settings and creates settings.json at the next save', async () => {
    const value = job(); files.set('sync.json', json(value.sync));
    expect((await folderSync('folder', value))!.selection).toMatchObject({ excludedFileTypes: [], extractArchives: false });
    value.selection = { ...defaultSelection(), excludedFileTypes: ['psd'] }; value.sync!.selection = value.selection;
    await writePostIndex(value);
    expect(JSON.parse(await files.get('settings.json')!.text())).toEqual(archiveSettings(value.source, value.selection));
    expect((await folderSync('folder', value))!.selection).toEqual(value.selection);
  });
  it('rejects malformed settings instead of treating them as an old archive', async () => {
    const value = job(); files.set('sync.json', json(value.sync)); files.set('settings.json', new Blob(['{broken']));
    await expect(folderSync('folder', value)).rejects.toThrow('not valid JSON');
  });
  it('persists recovery history and verifies extracted outputs before removing the compressed file', async () => {
    const value = job(), task = value.tasks[0];
    await removeExtractedArchive(value, task.id);
    expect(files.has(task.path)).toBe(false); expect(files.has(task.extraction!.files[0].path)).toBe(true);
    expect(events.indexOf('write:sync.json')).toBeLessThan(events.indexOf('remove:' + task.path));
    expect(JSON.parse(await files.get('sync.json')!.text()).posts[0].files[0].originalKept).toBe(false);
    await expect(removeExtractedArchive(value, task.id)).resolves.toBeUndefined();
  });
  it('keeps the original if extraction, an output or the metadata write fails', async () => {
    const value = job(), task = value.tasks[0];
    task.extraction!.state = 'failed'; await expect(removeExtractedArchive(value, task.id)).rejects.toThrow('incomplete');
    task.extraction!.state = 'done'; files.set(task.extraction!.files[0].path, new Blob(['bad']));
    await expect(removeExtractedArchive(value, task.id)).rejects.toThrow('incomplete'); expect(files.has(task.path)).toBe(true);
    files.set(task.extraction!.files[0].path, new Blob(['content'])); failIndex = true;
    await expect(removeExtractedArchive(value, task.id)).rejects.toThrow('Disk full'); expect(files.has(task.path)).toBe(true);
  });
  it('keeps the compressed source when an extracted output changes without changing size', async () => {
    const value = job(), task = value.tasks[0]; files.set(task.extraction!.files[0].path, new Blob(['changed']));
    await expect(removeExtractedArchive(value, task.id)).rejects.toThrow('changed'); expect(files.has(task.path)).toBe(true);
    expect(events.some(event => event.startsWith('remove:'))).toBe(false);
  });
  it('keeps a same-size replacement of the compressed source', async () => {
    const value = job(), task = value.tasks[0]; files.set(task.path, new Blob(['modified']));
    await expect(removeExtractedArchive(value, task.id)).rejects.toThrow('compressed file changed'); expect(await files.get(task.path)!.text()).toBe('modified');
    expect(events.some(event => event.startsWith('remove:'))).toBe(false);
  });
  it('rechecks archive identity after output verification before removing the source', async () => {
    const value = job(), task = value.tasks[0], output = files.get(task.extraction!.files[0].path)!, slice = output.slice.bind(output);
    output.slice = (...args) => { files.delete('sync.json'); return slice(...args); };
    await expect(removeExtractedArchive(value, task.id)).rejects.toThrow('valid sync.json'); expect(files.has(task.path)).toBe(true);
    expect(events.some(event => event.startsWith('remove:'))).toBe(false);
  });
  it('keeps new attachments in the existing post folder after a remote title changes', async () => {
    const value = job(); const extra = { ...value.tasks[0], id: '100:full res:/bb/cc/' + 'b'.repeat(64) + '.jpg', kind: 'image' as const, path: 'full res/100_Renamed/002_new.jpg', extraction: undefined, status: 'queued' as const };
    value.tasks.push(extra); await checkFolder(value); expect(extra.path).toBe('full res/100_Title/002_new.jpg');
  });
  it('repairs a missing output at its recorded path rather than changing shared references', async () => {
    const value = job(), task = value.tasks[0], original = task.path; task.extraction = undefined; task.path = 'full res/100_Renamed/001_renamed.zip'; files.delete(original);
    expect((await checkFolder(value)).files).toHaveLength(0); expect(task.path).toBe(original); expect(task.preservePath).toBe(true);
  });
  it('syncs complete extracted contents without the original, and redownloads if an output is missing or extraction is disabled', async () => {
    const value = job(), task = value.tasks[0]; await removeExtractedArchive(value, task.id);
    expect((await checkFolder(value)).files).toMatchObject([{ id: task.id, extraction: { state: 'done', originalRemoved: true } }]);
    const old = task.extraction; task.extraction = undefined;
    expect((await checkFolder(value)).files).toEqual([]);
    task.extraction = old; files.delete(task.extraction!.files[0].path);
    expect((await checkFolder(value)).files).toEqual([]);
  });
  it.each(['done', 'failed'] as const)('exports extracted files and keeps the compressed original only on failure (%s)', async state => {
    const value = job(), task = value.tasks[0]; value.destination = { kind: 'zip' }; task.status = 'staged'; task.extraction!.state = state;
    const output = new Map<string, Blob>();
    mocks.stagedFile.mockImplementation(async (_job: string, id: string) => id === task.id ? new Blob(['original']) : new Blob(['content']));
    mocks.createArchive.mockImplementation(async (_job: string, entries: AsyncIterable<{ path: string; blob: Blob }>, total: number) => {
      for await (const entry of entries) output.set(entry.path, entry.blob);
      expect(output.size).toBe(total); return { bytes: 100, entries: total };
    });
    await buildPostZip(value, new AbortController().signal, () => {});
    expect([...output.keys()].some(path => path.endsWith('001_bundle.zip'))).toBe(state === 'failed');
    expect([...output.keys()].some(path => path.endsWith('.extracted/nested/file.txt'))).toBe(true);
    expect([...output.keys()].some(path => path.endsWith('/settings.json'))).toBe(true);
  });
});
