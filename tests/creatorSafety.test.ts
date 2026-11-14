import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ requireDirectory: vi.fn() }));
vi.mock('../src/storage/destination', async original => ({ ...await original<typeof import('../src/storage/destination')>(), requireDirectory: mocks.requireDirectory }));
import { assertCreatorPath, contentDigest, discoverCreatorFolders, readCreatorIndex } from '../src/services/posts/creatorSafety';
import { writeRelativeFile } from '../src/storage/folderWriter';
import { creatorDirectory } from '../src/services/posts/destination';
import { defaultSelection } from '../src/services/posts/settings';
import { emptySync } from '../src/services/posts/sync';
import type { ArchiveDirectory } from '../src/storage/destination';

const source = { origin: 'https://pawchive.pw', platform: 'fanbox' as const, creatorId: '123', postId: null };
const index = () => emptySync({ source, creatorName: 'Creator', selection: defaultSelection() });
let writes: string[], reads: string[], files: Map<string, Blob>;
function directory(name: string, prefix = ''): ArchiveDirectory {
  const dirs = new Map<string, ArchiveDirectory>();
  const root = {
    kind: 'directory', name, prefix,
    queryPermission: async () => 'granted',
    getDirectoryHandle: async (part: string, options?: { create?: boolean }) => {
      if (!dirs.has(part)) { if (!options?.create) throw new DOMException('Missing', 'NotFoundError'); writes.push('mkdir:' + prefix + part); dirs.set(part, directory(part, prefix + part + '/')); }
      return dirs.get(part)!;
    },
    getFileHandle: async (part: string, options?: { create?: boolean }) => {
      const path = prefix + part; reads.push(name + ':' + part);
      if (!files.has(path) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      return { name: part, kind: 'file', getFile: async () => files.get(path), createWritable: async () => ({ write: async (blob: Blob | string) => { writes.push(path); files.set(path, typeof blob === 'string' ? new Blob([blob]) : blob); }, close: async () => {}, abort: async () => {} }) };
    },
    resolve: async (entry: { prefix?: string }) => entry.prefix?.startsWith(prefix) ? entry.prefix.slice(prefix.length).split('/').filter(Boolean) : null,
    values: async function* () { yield* dirs.values(); },
  };
  return root as unknown as ArchiveDirectory;
}
beforeEach(() => { writes = []; reads = []; files = new Map(); vi.resetAllMocks(); });
describe('creator filesystem boundary', () => {
  it.each(['Archive', 'full res', 'fanbox_456_Creator', 'patreon_123_Creator', 'fanbox_123_'])('rejects %s before opening its metadata or mutating it', async name => {
    const folder = directory(name); files.set('sync.json', new Blob([JSON.stringify(index())])); mocks.requireDirectory.mockResolvedValue(folder);
    await expect(writeRelativeFile('folder', 'full res/100_Title/file.jpg', new Blob(['new']), false, source)).rejects.toThrow();
    expect(reads).toEqual([]); expect(writes).toEqual([]);
  });
  it.each([undefined, '{broken', JSON.stringify({ format: 'other-app' })])('requires proper JSON even with a valid name and quality folders', async contents => {
    const folder = directory('fanbox_123_Creator'); if (contents) files.set('sync.json', new Blob([contents]));
    mocks.requireDirectory.mockResolvedValue(folder);
    await expect(writeRelativeFile('folder', 'sync.json', new Blob(['replacement']), true, source)).rejects.toThrow(); expect(writes).toEqual([]);
  });
  it('rejects a JSON identity that disagrees with the folder ID', async () => {
    files.set('sync.json', new Blob([JSON.stringify({ ...index(), source: { ...source, creatorId: '456' } })]));
    await expect(readCreatorIndex(directory('fanbox_123_Creator'), source)).rejects.toThrow('different'); expect(writes).toEqual([]);
  });
  it.each(['../other/file', 'D:/Archive/file', '//server/share/file', 'full res/100_Title/../file', 'full res/100_Title/a:stream', 'full res/100_Title/NUL.jpg', 'full res/100_Title./a', 'other/100_Title/file', 'full res/100_Title/sub/file', 'manifest.json'])('rejects unsafe or unmanaged path %s', path => {
    expect(() => assertCreatorPath(path)).toThrow(); expect(writes).toEqual([]);
  });
  it('preserves a conflicting file and reuses the exact same retry', async () => {
    files.set('sync.json', new Blob([JSON.stringify(index())])); files.set('full res/100_Title/file.jpg', new Blob(['old']));
    mocks.requireDirectory.mockResolvedValue(directory('fanbox_123_Creator'));
    const path = 'full res/100_Title/file.jpg';
    expect(await writeRelativeFile('folder', path, new Blob(['new']), false, source)).toBe('full res/100_Title/file (1).jpg');
    expect(await writeRelativeFile('folder', path, new Blob(['new']), false, source)).toBe('full res/100_Title/file (1).jpg');
    expect(await files.get(path)!.text()).toBe('old'); expect(writes.filter(path => path.endsWith('file (1).jpg'))).toHaveLength(1);
  });
  it('revalidates JSON on later writes rather than trusting an earlier grant', async () => {
    files.set('sync.json', new Blob([JSON.stringify(index())])); mocks.requireDirectory.mockResolvedValue(directory('fanbox_123_Creator'));
    await writeRelativeFile('folder', 'full res/100_Title/file.jpg', new Blob(['first']), false, source);
    const before = [...writes]; files.delete('sync.json');
    await expect(writeRelativeFile('folder', 'full res/100_Title/next.jpg', new Blob(['next']), false, source)).rejects.toThrow(); expect(writes).toEqual(before);
  });
  it('rechecks identity after a slow collision comparison before creating another file', async () => {
    files.set('sync.json', new Blob([JSON.stringify(index())])); mocks.requireDirectory.mockResolvedValue(directory('fanbox_123_Creator'));
    const old = new Blob(['old']), slice = old.slice.bind(old); old.slice = (...args) => { files.delete('sync.json'); return slice(...args); };
    files.set('full res/100_Title/file.jpg', old);
    await expect(writeRelativeFile('folder', 'full res/100_Title/file.jpg', new Blob(['new']), false, source)).rejects.toThrow('valid sync.json');
    expect(writes.filter(path => !path.startsWith('mkdir:'))).toEqual([]); expect(await old.text()).toBe('old');
  });
  it('rejects a directory handle resolving outside its creator root before writing a file', async () => {
    files.set('sync.json', new Blob([JSON.stringify(index())]));
    const folder = directory('fanbox_123_Creator'); folder.resolve = async () => null; mocks.requireDirectory.mockResolvedValue(folder);
    await expect(writeRelativeFile('folder', 'full res/100_Title/file.jpg', new Blob(['new']), false, source)).rejects.toThrow('escaped');
    expect(writes.filter(path => !path.startsWith('mkdir:'))).toEqual([]);
  });
  it('does not adopt an existing correctly named directory without JSON', async () => {
    const root = directory('Archive'); await root.getDirectoryHandle('fanbox_123_Creator', { create: true }); writes.length = 0;
    await expect(creatorDirectory(root, { source, creatorName: 'Creator' })).rejects.toThrow('valid sync.json'); expect(writes).toEqual([]);
  });
  it('creates identity metadata only in a newly created empty creator directory', async () => {
    const folder = await creatorDirectory(directory('Archive'), { source, creatorName: 'Creator' });
    expect(folder.name).toBe('fanbox_123_Creator'); expect(writes).toEqual(['mkdir:fanbox_123_Creator', 'fanbox_123_Creator/sync.json']);
  });
  it('discovers only valid named archives without reading unrelated folder contents or writing anything', async () => {
    const root = directory('Archive');
    await root.getDirectoryHandle('Unrelated', { create: true }); await root.getDirectoryHandle('fanbox_123_Creator', { create: true }); await root.getDirectoryHandle('fanbox_456_Invalid', { create: true });
    files.set('fanbox_123_Creator/sync.json', new Blob([JSON.stringify(index())])); writes.length = 0; reads.length = 0;
    const found = await discoverCreatorFolders(root);
    expect(found.map(item => item.directory.name)).toEqual(['fanbox_123_Creator']); expect(reads.some(path => path.startsWith('Unrelated:'))).toBe(false); expect(writes).toEqual([]);
  });
  it('hashes all bytes in bounded chunks and detects a same-size change beyond sampled regions', async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024); const original = new Blob([bytes]);
    original.arrayBuffer = () => { throw new Error('Unbounded read'); };
    const hash = await contentDigest(original); bytes[1024 * 1024 + 123] = 1;
    expect(await contentDigest(new Blob([bytes]))).not.toBe(hash); expect(await contentDigest(new Blob([new Uint8Array(bytes.length)]))).toBe(hash);
  });
  it('preserves a legacy single-post archive scope during root import', async () => {
    const root = directory('Archive'); await root.getDirectoryHandle('fanbox_123_Creator', { create: true });
    const old = index(); delete old.scope; files.set('fanbox_123_Creator/sync.json', new Blob([JSON.stringify(old)]));
    files.set('fanbox_123_Creator/manifest.json', new Blob([JSON.stringify({ schemaVersion: 1, sourceUrl: source.origin + '/fanbox/user/123/post/100', creator: 'Creator', selection: defaultSelection(), files: [], posts: [] })]));
    writes.length = 0; const found = await discoverCreatorFolders(root);
    expect(found[0].source.postId).toBe('100'); expect(writes).toEqual([]);
  });
});
