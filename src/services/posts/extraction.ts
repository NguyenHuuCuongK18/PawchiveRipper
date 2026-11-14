import { relativePathParts, writeRelativeFile } from '../../storage/folderWriter';
import { stagedFile, removeStagedFile } from '../../storage/zipCache';
import { postRelativePath } from './media';
import { syncKey } from './sync';
import { writePostIndex } from './folder';
import { IdenticalFileIndex } from './identicalFiles';
import { isArchive } from './fileTypes';
import type { ExtractedFile, PostExtraction, PostJob, PostTask } from './types';
import { contentDigest, requireCreatorDirectory, assertCreatorPath } from './creatorSafety';

interface Running { jobId: string; result: PostExtraction; worker?: Worker; timer?: ReturnType<typeof setTimeout> }
const running = new Map<string, Running>();
const key = (jobId: string, id: string) => `${jobId}:${id}`;
export function extractingJobs(): string[] { return [...running.values()].map(item => item.jobId); }
export function stopExtractions(jobId?: string): void {
  for (const [id, item] of running) if (jobId === undefined || item.jobId === jobId) { item.worker?.terminate(); clearTimeout(item.timer); running.delete(id); }
}
async function sourceFile(job: PostJob, task: PostTask): Promise<Blob> {
  if (task.status === 'downloaded' && job.destination?.kind === 'folder') {
    const parts = relativePathParts(postRelativePath(task)); let directory: FileSystemDirectoryHandle = await requireCreatorDirectory(job.destination.directoryId, job.source);
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    return (await directory.getFileHandle(parts.at(-1)!)).getFile();
  }
  return stagedFile(job.id, task.id);
}
export function startExtraction(job: PostJob, id: string): void {
  const entryKey = key(job.id, id); if (running.has(entryKey)) return;
  const item: Running = { jobId: job.id, result: { state: 'extracting', files: [] } }; running.set(entryKey, item);
  void (async () => {
    const task = job.tasks.find(task => task.id === id); if (!task?.extraction) throw new Error('Archive extraction task was not found.');
    const file = await sourceFile(job, task);
    const sourceDigest = await contentDigest(file);
    if (running.get(entryKey) !== item) return;
    const worker = item.worker = new Worker(chrome.runtime.getURL('extract-worker.js'), { type: 'module' });
    const finish = (error?: string, files = item.result.files) => {
      worker.terminate(); clearTimeout(item.timer); item.worker = undefined;
      item.result = { state: error ? 'failed' : 'done', files, sourceDigest, ...(error ? { error } : {}) };
    };
    const reset = () => { clearTimeout(item.timer); item.timer = setTimeout(() => finish('Archive extraction stopped making progress. The original was kept.'), 120_000); };
    worker.onmessage = event => {
      const message = event.data as { type: string; file?: ExtractedFile; files?: ExtractedFile[]; error?: string };
      reset();
      if (message.type === 'file' && message.file) item.result.files.push(message.file);
      if (message.type === 'done') finish(message.error, message.files);
    };
    worker.onerror = () => finish('Archive decoder could not read this file. The original was kept.');
    reset(); worker.postMessage({ jobId: job.id, id: syncKey(task.id), file, name: task.path, prefix: postRelativePath(task) + '.extracted/', wasmUrl: chrome.runtime.getURL('libarchive.wasm') });
  })().catch(error => { item.result = { state: 'failed', files: [], error: error instanceof Error ? error.message : 'Archive extraction failed. The original was kept.' }; });
}
export function extractionStatus(jobId: string, id: string): PostExtraction | null { return running.get(key(jobId, id))?.result || null; }
export async function deduplicateExtraction(job: PostJob, id: string): Promise<ExtractedFile[]> {
  const result = extractionStatus(job.id, id); if (!result || result.state === 'extracting') throw new Error('Archive extraction is not ready.');
  if (!job.selection.deduplicate) return result.files;
  const task = job.tasks.find(task => task.id === id)!;
  const index = new IdenticalFileIndex(`${job.destination?.kind === 'folder' ? job.destination.directoryId : job.id}:${task.quality}`), seen = new Set<string>();
  const folder = job.destination?.kind === 'folder' ? await requireCreatorDirectory(job.destination.directoryId, job.source) : undefined;
  const readFolder = async (path: string): Promise<Blob> => {
    let directory: FileSystemDirectoryHandle = folder!; const parts = relativePathParts(path);
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    return (await directory.getFileHandle(parts.at(-1)!)).getFile();
  };
  const add = (file: ExtractedFile, read: () => Promise<Blob>) => {
    if (file.duplicateOf || seen.has(file.path) || !file.path.startsWith(task.quality + '/')) return;
    seen.add(file.path); index.add({ ...file, read });
  };
  for (const other of job.tasks) if (other.id !== id && ['staged', 'downloaded'].includes(other.status) && other.kind !== 'text') {
    // Top-level archive sources may be removed after extraction, so they cannot own shared outputs.
    if (!other.extraction && !isArchive(other.path)) {
      const file = { id: other.id, path: postRelativePath(other), bytes: other.bytes! };
      add(file, () => other.status === 'downloaded' && folder ? readFolder(file.path) : stagedFile(job.id, other.id));
    }
    if (other.extraction?.state === 'done') for (const file of other.extraction.files) add(file, () => other.status === 'downloaded' && folder ? readFolder(file.path) : stagedFile(job.id, file.id));
  }
  if (folder) for (const post of job.sync?.posts || []) for (const saved of post.files) {
    if (syncKey(saved.id) === syncKey(id)) continue;
    if (saved.originalKept !== false && saved.kind !== 'text' && !isArchive(saved.path)) add(saved, () => readFolder(saved.path));
    for (const file of saved.extracted || []) add(file, () => readFolder(file.path));
  }
  const files: ExtractedFile[] = [];
  for (const file of result.files) {
    const blob = await stagedFile(job.id, file.id); if (blob.size !== file.bytes) throw new Error('Extracted file is incomplete.');
    const duplicateOf = await index.match(blob);
    files.push(duplicateOf ? { ...file, duplicateOf } : file);
    if (!duplicateOf) add(file, () => stagedFile(job.id, file.id));
  }
  result.files = files; return files;
}
export function forgetExtraction(jobId: string, id: string): void { const item = running.get(key(jobId, id)); item?.worker?.terminate(); clearTimeout(item?.timer); running.delete(key(jobId, id)); }
export async function commitExtraction(job: PostJob, id: string): Promise<ExtractedFile[]> {
  if (job.destination?.kind !== 'folder') throw new Error('Choose a creator folder first.');
  const result = extractionStatus(job.id, id); if (!result || result.state === 'extracting') throw new Error('Archive extraction is not ready.');
  const files: ExtractedFile[] = [];
  for (const file of result.files) {
    if (file.duplicateOf) { files.push(file); continue; }
    const blob = await stagedFile(job.id, file.id); if (blob.size !== file.bytes) throw new Error('Extracted file is incomplete.');
    // Reuse equal bytes; preserve a changed or user-created file at this path.
    files.push({ ...file, path: await writeRelativeFile(job.destination.directoryId, file.path, blob, false, job.source) });
  }
  return files;
}
export async function clearExtractedCache(jobId: string, files: ExtractedFile[]): Promise<void> {
  for (const file of files) await removeStagedFile(jobId, file.id).catch(() => {});
}
// Persist recovery metadata and verify every output before removing the compressed source.
// Repeating this after a worker restart is safe, including an already removed source.
export async function removeExtractedArchive(job: PostJob, id: string): Promise<void> {
  const task = job.tasks.find(task => task.id === id);
  if (job.destination?.kind !== 'folder' || task?.extraction?.state !== 'done' || !task.extraction.files.length) throw new Error('Archive extraction is incomplete. The original was kept.');
  await writePostIndex(job);
  const root = await requireCreatorDirectory(job.destination.directoryId, job.source);
  for (const entry of task.extraction.files) {
    let directory: FileSystemDirectoryHandle = root; const parts = relativePathParts(entry.duplicateOf?.path || entry.path);
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    const output = await (await directory.getFileHandle(parts.at(-1)!)).getFile();
    if (output.size !== entry.bytes || !entry.digest || await contentDigest(output) !== entry.digest) throw new Error('An extracted file is incomplete or changed. The original was kept.');
  }
  let directory: FileSystemDirectoryHandle = root; const parts = relativePathParts(postRelativePath(task));
  assertCreatorPath(postRelativePath(task));
  try {
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    const file = await (await directory.getFileHandle(parts.at(-1)!)).getFile();
    if (file.size !== task.bytes || !task.extraction.sourceDigest || await contentDigest(file) !== task.extraction.sourceDigest) throw new Error('The compressed file changed after extraction or its identity is unknown. It was kept.');
    const current = await requireCreatorDirectory(job.destination.directoryId, job.source), resolved = await current.resolve(directory);
    if (!resolved || resolved.join('/') !== parts.slice(0, -1).join('/')) throw new Error('The archive source escaped its creator folder. It was kept.');
    await directory.removeEntry(parts.at(-1)!);
  } catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
}
