import { FolderPermissionError, requireDirectory } from './destination';
import { assertCreatorPath, requireCreatorDirectory } from '../services/posts/creatorSafety';
import { filesIdentical } from '../services/posts/identicalFiles';
import type { PostScope } from '../services/posts/types';
export function relativePathParts(path: string): string[] {
  const parts = path.split('/');
  if (!path || parts.some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f<>"|?*]/.test(p))) throw new Error('Unsafe archive path');
  return parts;
}
export function pathParts(path: string): string[] {
  const parts = relativePathParts(path);
  if (parts[0] !== 'ArchiveRoot' || parts.length < 2) throw new Error('Unsafe archive path');
  return parts;
}
async function parent(jobId: string, path: string, create: boolean, relative = false, source?: PostScope): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
  const parts = relative ? relativePathParts(path) : pathParts(path);
  const root = relative && source ? await requireCreatorDirectory(jobId, source) : await requireDirectory(jobId);
  let directory: FileSystemDirectoryHandle = root;
  for (const [index, part] of parts.slice(0, -1).entries()) {
    directory = await directory.getDirectoryHandle(part, { create });
    if (relative) {
      const resolved = await root.resolve(directory);
      if (!resolved || resolved.join('/') !== parts.slice(0, index + 1).join('/')) throw new Error('The destination escaped its creator folder.');
    }
  }
  return { directory, name: parts.at(-1)! };
}
export async function sha256(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function fileMatches(jobId: string, path: string, hash: string, bytes: number): Promise<boolean> {
  try {
    const { directory, name } = await parent(jobId, path, false);
    const file = await (await directory.getFileHandle(name)).getFile();
    return file.size === bytes && await sha256(file) === hash;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) throw new FolderPermissionError();
    throw error;
  }
}
// Serialize reservations so two writes cannot choose the same unused name.
let writes: Promise<unknown> = Promise.resolve();
export function writeFile(jobId: string, path: string, blob: Blob, overwrite = false): Promise<string> {
  // Old Discord jobs held a parent-directory capability. They may not inherit
  // permission to write outside a validated creator archive after this update.
  return Promise.reject(new Error('Legacy folder writes are disabled. Export Discord as a ZIP instead.'));
}
export async function writeRelativeFile(directoryId: string, path: string, blob: Blob, overwrite = false, source?: PostScope): Promise<string> {
  if (!source) throw new Error('A registered creator identity is required for folder writes.');
  assertCreatorPath(path);
  return writeArchiveFile(directoryId, path, blob, overwrite, true, source);
}
function writeArchiveFile(jobId: string, path: string, blob: Blob, overwrite: boolean, relative: boolean, source?: PostScope): Promise<string> {
  const next = writes.catch(() => {}).then(async () => {
    try {
      const { directory, name } = await parent(jobId, path, true, relative, source);
      const dot = name.lastIndexOf('.'); const stem = dot < 0 ? name : name.slice(0, dot); const extension = dot < 0 ? '' : name.slice(dot);
      let chosen = name;
      if (overwrite) {
        try {
          const existing = await (await directory.getFileHandle(name)).getFile();
          // Avoid rewriting identical output, but replace stale data at this path.
          if (existing.size === blob.size && await filesIdentical(existing, blob)) return path;
        } catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
      } else for (let suffix = 0; ; suffix++) {
        chosen = suffix ? `${stem} (${suffix})${extension}` : name;
        try {
          const existing = await (await directory.getFileHandle(chosen)).getFile();
          // A completed write before a worker restart can be reused safely.
          if (existing.size === blob.size && await filesIdentical(existing, blob)) return path.slice(0, -name.length) + chosen;
        } catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') break; throw error; }
      }
      if (relative && source) {
        const current = await requireCreatorDirectory(jobId, source), resolved = await current.resolve(directory);
        if (!resolved || resolved.join('/') !== relativePathParts(path).slice(0, -1).join('/')) throw new Error('The destination escaped its creator folder.');
      }
      const file = await directory.getFileHandle(chosen, { create: true });
      const stream = await file.createWritable();
      try { await stream.write(blob); await stream.close(); } catch (error) { await stream.abort().catch(() => {}); throw error; }
      return path.slice(0, -name.length) + chosen;
    } catch (error) {
      if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) throw new FolderPermissionError();
      throw error;
    }
  });
  writes = next; return next;
}
