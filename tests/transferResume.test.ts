import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchAttachment, strongETag, type ResumeCheckpoint } from '../src/services/posts/resume';
import { clearResume, readResume, RESUME_CHUNK_BYTES, stageResumable } from '../src/storage/zipCache';

const url = 'https://file.pawchive.pw/data/aa/bb/' + 'a'.repeat(64) + '.bin';
const checkpoint: ResumeCheckpoint = { url, etag: '"same-version"', bytes: 8, total: 12, files: [] };
afterEach(() => vi.unstubAllGlobals());
it('resumes only a matching strong validator and exact content range', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('tail', { status: 206, headers: { etag: checkpoint.etag, 'content-range': 'bytes 8-11/12', 'content-length': '4' } })); vi.stubGlobal('fetch', fetch);
  const session = await fetchAttachment(url, checkpoint, new AbortController().signal);
  expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { Range: 'bytes=8-', 'If-Range': checkpoint.etag }, credentials: 'omit', redirect: 'error' });
  expect(session).toMatchObject({ offset: 8, total: 12, etag: checkpoint.etag });
});
it.each<ResponseInit>([
  { status: 206, headers: { etag: '"changed"', 'content-range': 'bytes 8-11/12' } },
  { status: 206, headers: { etag: checkpoint.etag, 'content-range': 'bytes 7-11/12' } },
  { status: 206, headers: { etag: checkpoint.etag, 'content-range': 'bytes 8-11/13' } },
  { status: 206, headers: { etag: checkpoint.etag, 'content-range': 'bytes 8-11/12', 'content-length': '3' } },
  { status: 416, headers: {} },
])('restarts safely when a resume response cannot be verified: %j', async invalid => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('tail', invalid)).mockResolvedValueOnce(new Response('replacement', { headers: { 'content-length': '11' } })); vi.stubGlobal('fetch', fetch);
  const session = await fetchAttachment(url, checkpoint, new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1][1].headers).toBeUndefined(); expect(session.offset).toBe(0); expect(await session.response.text()).toBe('replacement');
});
it('uses a full response when the server ignores Range, and rejects unsolicited partial bytes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('full', { headers: { 'content-length': '4' } })));
  expect((await fetchAttachment(url, checkpoint, new AbortController().signal)).offset).toBe(0);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('tail', { status: 206 })));
  await expect(fetchAttachment(url, undefined, new AbortController().signal)).rejects.toThrow('unverified partial');
});
it('never resumes weak validators or a checkpoint for another URL', async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response('full', { headers: { etag: 'W/"weak"', 'accept-ranges': 'bytes', 'content-length': '4' } })); vi.stubGlobal('fetch', fetch);
  expect((await fetchAttachment(url, { ...checkpoint, etag: 'W/"weak"' }, new AbortController().signal)).etag).toBeUndefined();
  await fetchAttachment(url, { ...checkpoint, url: url + '?different' }, new AbortController().signal);
  expect(fetch.mock.calls.every(call => call[1].headers === undefined)).toBe(true); expect(strongETag('"valid"')).toBe(true); expect(strongETag('"bad\rheader"')).toBe(false);
});

class MemoryFile {
  readonly kind = 'file'; file: File;
  constructor(readonly name: string) { this.file = new File([], name); }
  async getFile() { return this.file; }
  async createWritable() {
    const parts: BlobPart[] = [], file = this;
    const output = new WritableStream<BlobPart>({ write(value) { parts.push(value); }, close() { file.file = new File(parts, file.name); } });
    return Object.assign(output, {
      write: async (value: BlobPart) => { const writer = output.getWriter(); try { await writer.write(value); } finally { writer.releaseLock(); } },
      close: async () => { const writer = output.getWriter(); try { await writer.close(); } finally { writer.releaseLock(); } },
    });
  }
}
class MemoryDirectory {
  readonly kind = 'directory'; children = new Map<string, MemoryDirectory | MemoryFile>();
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    if (!this.children.has(name) && options?.create) this.children.set(name, new MemoryDirectory(name));
    const entry = this.children.get(name); if (!entry || entry.kind !== 'directory') throw new DOMException('Missing', 'NotFoundError'); return entry;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    if (!this.children.has(name) && options?.create) this.children.set(name, new MemoryFile(name));
    const entry = this.children.get(name); if (!entry || entry.kind !== 'file') throw new DOMException('Missing', 'NotFoundError'); return entry;
  }
  async removeEntry(name: string) { if (!this.children.delete(name)) throw new DOMException('Missing', 'NotFoundError'); }
  async *values() { yield* this.children.values(); }
}
let root: MemoryDirectory, jobId: string;
beforeEach(() => { root = new MemoryDirectory('private'); jobId = crypto.randomUUID(); vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } }); });
it('retains closed private chunks across interruption and assembles the resumed file with exact bytes', async () => {
  let pulls = 0;
  const first = new ReadableStream<Uint8Array>({ pull(controller) { if (!pulls++) controller.enqueue(new Uint8Array(RESUME_CHUNK_BYTES).fill(7)); else controller.error(new Error('Connection interrupted')); } });
  const total = RESUME_CHUNK_BYTES + 13, signal = new AbortController().signal;
  await expect(stageResumable(jobId, 'attachment', first, signal, { url, etag: '"version"', total })).rejects.toThrow('interrupted');
  const saved = await readResume(jobId, 'attachment', url); expect(saved?.bytes).toBe(RESUME_CHUNK_BYTES); expect(saved?.files).toHaveLength(1);
  const file = await stageResumable(jobId, 'attachment', new Blob([new Uint8Array(13).fill(9)]).stream(), signal, { url, etag: '"version"', total, checkpoint: saved });
  expect(file.size).toBe(total); expect(new Uint8Array(await file.slice(0, 1).arrayBuffer())[0]).toBe(7); expect([...new Uint8Array(await file.slice(-13).arrayBuffer())]).toEqual(new Array(13).fill(9));
  const expected = new Uint8Array(total).fill(7); expected.fill(9, RESUME_CHUNK_BYTES);
  expect(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).toEqual(new Uint8Array(await crypto.subtle.digest('SHA-256', expected)));
  expect(await readResume(jobId, 'attachment', url)).toBeUndefined();
});
it('ignores foreign checkpoints and confines chunk cleanup to this private job and task', async () => {
  let pulls = 0; const signal = new AbortController().signal;
  const input = new ReadableStream<Uint8Array>({ pull(controller) { if (!pulls++) controller.enqueue(new Uint8Array(RESUME_CHUNK_BYTES)); else controller.error(new Error('Interrupted')); } });
  await expect(stageResumable(jobId, 'attachment', input, signal, { url, etag: '"version"', total: RESUME_CHUNK_BYTES + 1 })).rejects.toThrow();
  expect(await readResume(jobId, 'attachment', url + '?foreign')).toBeUndefined();
  const unrelated = await root.getDirectoryHandle('unrelated', { create: true }); const precious = await unrelated.getFileHandle('keep', { create: true }); precious.file = new File(['KEEP'], 'keep');
  const job = await (await root.getDirectoryHandle('kemono-zip-jobs')).getDirectoryHandle(jobId); const other = await job.getFileHandle('other-task.part.0', { create: true });
  await clearResume(jobId, 'attachment'); expect(await precious.file.text()).toBe('KEEP'); expect(job.children.get('other-task.part.0')).toBe(other);
});
it('refuses to resume a missing or modified private chunk', async () => {
  let pulls = 0; const input = new ReadableStream<Uint8Array>({ pull(controller) { if (!pulls++) controller.enqueue(new Uint8Array(RESUME_CHUNK_BYTES)); else controller.error(new Error('Interrupted')); } });
  await expect(stageResumable(jobId, 'attachment', input, new AbortController().signal, { url, etag: '"version"', total: RESUME_CHUNK_BYTES + 1 })).rejects.toThrow();
  const job = await (await root.getDirectoryHandle('kemono-zip-jobs')).getDirectoryHandle(jobId), part = [...job.children.values()].find(entry => entry.kind === 'file' && entry.name.endsWith('.part.0')) as MemoryFile;
  part.file = new File(['short'], part.name); expect(await readResume(jobId, 'attachment', url)).toBeUndefined();
});
