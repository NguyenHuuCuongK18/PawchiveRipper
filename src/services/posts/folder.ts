import { requireDirectory, getDirectory, FolderPermissionError } from '../../storage/destination';
import { readCreatorIndex, assertCreatorPath } from './creatorSafety';
import { postRelativePath } from './media';
import { relativePathParts, writeRelativeFile } from '../../storage/folderWriter';
import { stagedFile } from '../../storage/zipCache';
import { assertSyncSource, mergeSync, syncKey } from './sync';
import { postFailures } from './failures';
import { archiveSettings, parseSettings } from './settings';
import { attachmentKey, duplicateReport } from './duplicates';
import type { PostDuplicate, PostExtraction, PostJob, PostSyncFile, PostSyncIndex } from './types';

export async function folderSync(directoryId: string, job: PostJob, readOnly = false): Promise<PostSyncIndex | undefined> {
  const directory = readOnly ? await getDirectory(directoryId) : await requireDirectory(directoryId);
  if (!directory || readOnly && await directory.queryPermission({ mode: 'read' }) !== 'granted') throw new FolderPermissionError();
  const index = await readCreatorIndex(directory, job.source);
  try {
    const settings = await (await directory.getFileHandle('settings.json')).getFile();
    if (settings.size > 128 * 1024) throw new Error('Archive settings.json is too large.');
    let value: unknown; try { value = JSON.parse(await settings.text()); } catch { throw new Error('Archive settings.json is not valid JSON.'); }
    index.selection = parseSettings(value, job.source);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    index.selection = { ...index.selection, excludedFileTypes: [], extractArchives: false };
  }
  return index;
}
export async function checkFolder(job: PostJob): Promise<{ sync: PostSyncIndex | undefined; files: { id: string; path: string; bytes: number; extraction?: PostExtraction }[]; duplicates: PostDuplicate[] }> {
  if (job.destination?.kind !== 'folder') throw new Error('Choose a creator folder first.');
  const directoryId = job.destination.directoryId, directory = await requireDirectory(directoryId);
  const existing = await folderSync(directoryId, job);
  const sync = existing ? mergeSync(job.sync, existing) : job.sync;
  const downloaded = new Map(sync?.posts.flatMap(post => post.files.map(file => [file.id, file] as const)) || []);
  const writable = (path: string) => { try { assertCreatorPath(path); return !/[\p{Cc}\p{Cf}\p{Cs}\p{Noncharacter_Code_Point}]/u.test(path); } catch { return false; } };
  const postFolders = new Map<string, string>();
  for (const post of sync?.posts || []) for (const file of post.files) if (writable(file.path)) {
    const folder = relativePathParts(file.path)[1];
    if (!postFolders.has(`${post.id}:${file.quality}`)) postFolders.set(`${post.id}:${file.quality}`, folder);
  }
  for (const task of job.tasks) {
    if (postRelativePath(task) !== task.path) throw new Error('Unexpected creator-folder task path.');
    const saved = downloaded.get(syncKey(task.id));
    if (saved && writable(saved.path)) { task.path = saved.path; task.preservePath = true; }
    else {
      const folder = postFolders.get(`${task.postId}:${task.quality}`);
      if (folder) { const parts = relativePathParts(task.path); parts[1] = folder; task.path = parts.join('/'); }
    }
  }
  const files = [];
  const duplicates: PostDuplicate[] = [];
  const byContent = new Map<string, PostSyncFile[]>();
  if (job.selection.deduplicate) for (const saved of downloaded.values()) {
    const key = attachmentKey(saved.id, saved.quality); if (!key) continue;
    const group = byContent.get(key) || []; group.push(saved); byContent.set(key, group);
  }
  const directories = new Map<string, FileSystemDirectoryHandle>([['', directory]]);
  async function matches(path: string, bytes: number): Promise<boolean> {
    try {
      let parent: FileSystemDirectoryHandle = directory;
      const parts = relativePathParts(path);
      let prefix = '';
      for (const part of parts.slice(0, -1)) {
        prefix += part + '/';
        parent = directories.get(prefix) || await parent.getDirectoryHandle(part);
        directories.set(prefix, parent);
      }
      return (await (await parent.getFileHandle(parts.at(-1)!)).getFile()).size === bytes;
    } catch (error) {
      // Older ZIPs can contain names the local File System Access API rejects.
      // Leave their history intact until a replacement saves at its new safe path.
      if (error instanceof DOMException && error.name === 'NotFoundError' || error instanceof TypeError && error.message.includes('Name is not allowed')) return false;
      throw error;
    }
  }
  for (const task of job.tasks) {
    const saved = downloaded.get(syncKey(task.id)); if (!saved) continue;
    if (task.kind === 'text' && job.postFingerprints && sync?.remote?.[task.postId] !== job.postFingerprints[task.postId]) continue;
    const original = await matches(saved.path, saved.bytes);
    let extraction: PostExtraction | undefined;
    if (task.extraction && saved.extracted?.length) {
      let complete = true;
      for (const entry of saved.extracted) if ((!job.selection.deduplicate && entry.duplicateOf) || !await matches(entry.duplicateOf?.path || entry.path, entry.bytes)) { complete = false; break; }
      if (complete) extraction = { state: 'done', files: saved.extracted, originalRemoved: !original, sourceDigest: saved.sourceDigest,
        retainOriginal: original && (job.selection.keepArchives === true || !saved.sourceDigest || saved.extracted.some(file => !file.digest)) };
    }
    if (original || (extraction && saved.originalKept === false)) files.push({ id: task.id, path: saved.path, bytes: saved.bytes, ...(extraction ? { extraction } : {}) });
  }
  if (job.selection.deduplicate) {
    const savedIds = new Set(files.map(file => file.id));
    for (const task of job.tasks) if (!savedIds.has(task.id)) {
      const key = attachmentKey(task.id, task.quality); if (!key) continue;
      for (const saved of byContent.get(key) || []) {
        if (saved.id === syncKey(task.id)) continue;
        let intact = saved.originalKept !== false && await matches(saved.path, saved.bytes);
        if (!intact && task.extraction && saved.originalKept === false && saved.extracted?.length) {
          intact = true;
          for (const entry of saved.extracted) if (!await matches(entry.duplicateOf?.path || entry.path, entry.bytes)) { intact = false; break; }
        }
        if (!intact) continue;
        const retainedPaths = saved.originalKept === false ? saved.extracted!.map(entry => entry.duplicateOf?.path || entry.path) : undefined;
        duplicates.push({ postId: task.postId, path: task.path, duplicateOf: retainedPaths?.[0] || saved.path, keptTaskId: saved.id, existing: true, bytes: saved.bytes, ...(retainedPaths ? { retainedPaths } : {}) }); break;
      }
    }
  }
  return { sync, files, duplicates };
}
export async function writePostFile(job: PostJob, taskId: string): Promise<{ path: string; bytes: number }> {
  if (job.destination?.kind !== 'folder') throw new Error('Choose a creator folder first.');
  const task = job.tasks.find(task => task.id === taskId);
  if (!task || task.status !== 'staged') throw new Error('The attachment is not ready to save.');
  const blob = await stagedFile(job.id, task.id);
  if (blob.size !== task.bytes) throw new Error('The collected attachment is incomplete. Retry this download.');
  return { path: await writeRelativeFile(job.destination.directoryId, postRelativePath(task), blob, false, job.source), bytes: blob.size };
}
export async function writePostIndex(job: PostJob): Promise<void> {
  if (job.destination?.kind !== 'folder' || !job.sync) throw new Error('Choose a creator folder first.');
  const directoryId = job.destination.directoryId;
  assertSyncSource(job.sync, job.source);
  const existing = await folderSync(directoryId, job);
  const index = mergeSync(existing, job.sync);
  await writeRelativeFile(directoryId, 'sync.json', new Blob([JSON.stringify(index, null, 2)], { type: 'application/json' }), true, job.source);
  await writeRelativeFile(directoryId, 'failures.json', new Blob([JSON.stringify(postFailures(job), null, 2)], { type: 'application/json' }), true, job.source);
  if (job.selection.deduplicate || job.duplicates?.length) await writeRelativeFile(directoryId, 'duplicates.json', new Blob([JSON.stringify(duplicateReport(job), null, 2)], { type: 'application/json' }), true, job.source);
  const settings = JSON.stringify(archiveSettings(job.source, job.selection), null, 2);
  let unchanged = false;
  try { unchanged = await (await (await (await requireDirectory(directoryId)).getFileHandle('settings.json')).getFile()).text() === settings; }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  if (!unchanged) await writeRelativeFile(directoryId, 'settings.json', new Blob([settings], { type: 'application/json' }), true, job.source);
}
