import { requireDirectory, type ArchiveDirectory } from '../../storage/destination';
import { parseSync } from './sync';
import type { PostScope, PostSyncIndex } from './types';
import { parsePostUrl } from '../registry';

export const creatorNamePattern = /^(fanbox|patreon)_([0-9]+)_(.+)$/u;
export function assertCreatorName(name: string, source: PostScope): void {
  const match = creatorNamePattern.exec(name);
  if (!match || match[1] !== source.platform || match[2] !== source.creatorId) throw new Error('Unsafe archive folder: its name must match the creator service and ID.');
}
export async function readCreatorIndex(directory: FileSystemDirectoryHandle, source: PostScope): Promise<PostSyncIndex> {
  assertCreatorName(directory.name, source);
  for (const name of ['sync.json', 'manifest.json']) {
    let file: File;
    try { file = await (await directory.getFileHandle(name)).getFile(); }
    catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') continue; throw error; }
    if (file.size > 32 * 1024 * 1024) throw new Error('The sync JSON exceeds the 32 MiB limit.');
    return parseSync(JSON.parse(await file.text()), source);
  }
  throw new Error('Unsafe archive folder: a valid sync.json or legacy manifest.json is required.');
}
export async function requireCreatorDirectory(id: string, source: PostScope): Promise<ArchiveDirectory> {
  const directory = await requireDirectory(id);
  await readCreatorIndex(directory, source);
  return directory;
}
export async function discoverCreatorFolders(root: FileSystemDirectoryHandle): Promise<{ directory: ArchiveDirectory; index: PostSyncIndex; source: PostScope }[]> {
  const found: { directory: ArchiveDirectory; index: PostSyncIndex; source: PostScope }[] = [];
  for await (const entry of (root as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> }).values()) {
    if (entry.kind !== 'directory' || !creatorNamePattern.test(entry.name)) continue;
    const directory = entry as ArchiveDirectory;
    try {
      let source: PostScope | null = null;
      for (const name of ['sync.json', 'manifest.json']) {
        let file: File;
        try { file = await (await directory.getFileHandle(name)).getFile(); }
        catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') continue; throw error; }
        if (file.size > 32 * 1024 * 1024) throw new Error('Oversized archive history.');
        const data = JSON.parse(await file.text());
        source = parsePostUrl(data.sourceUrl || `${data.source?.origin}/${data.source?.platform}/user/${data.source?.creatorId}`);
        break;
      }
      if (!source) continue;
      const index = await readCreatorIndex(directory, source);
      if (index.scope) source = { ...source, postId: index.scope.postId };
      else {
        // Older sync.json omitted scope. The original export manifest is the
        // only evidence that an archive came from a single-post/subset save.
        let manifest: File | undefined;
        try { manifest = await (await directory.getFileHandle('manifest.json')).getFile(); }
        catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
        if (manifest) {
          if (manifest.size > 32 * 1024 * 1024) throw new Error('Oversized legacy manifest.');
          const data = JSON.parse(await manifest.text());
          parseSync(data, source);
          const legacySource = parsePostUrl(data.sourceUrl);
          if (!legacySource) throw new Error('Invalid original archive scope.');
          source = legacySource;
          index.scope = { postId: source.postId };
          if (!source.postId && data.scan?.complete === true && Number.isSafeInteger(data.scan.total) && data.scan.total > data.posts.length) index.scope.selectedPostIds = data.posts.map((post: { id: string }) => post.id);
        }
      }
      found.push({ directory, index, source });
    } catch { /* Ineligible entries are read-only and never registered or repaired. */ }
  }
  return found;
}
export function assertCreatorPath(path: string): void {
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe creator archive path.');
  if (parts.length === 1 && ['sync.json', 'settings.json', 'failures.json', 'duplicates.json', 'sync-state.json'].includes(path)) return;
  if (!['full res', 'thumbnail'].includes(parts[0]) || !/^(?:(?:\d{4}-\d{2}-\d{2}|unknown-date)_)?(?:p-)?\d+_/.test(parts[1] || '') || parts.length < 3) throw new Error('Path is outside the managed creator layout.');
  if (parts.length > 3 && !parts[2].endsWith('.extracted')) throw new Error('Path is outside an extracted archive.');
}
// Bounded cryptographic identity over all bytes, never a sampled fingerprint.
export async function contentDigest(blob: Blob): Promise<string> {
  const hashes: string[] = [];
  for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.slice(offset, offset + 1024 * 1024).arrayBuffer());
    hashes.push(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${blob.size}:${hashes.join(':')}`));
  return 'sha256-chunks-v1:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
