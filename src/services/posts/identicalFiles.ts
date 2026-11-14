import type { FileReference } from './types';

export interface FileCandidate extends FileReference { bytes: number; read: () => Promise<Blob> }
const candidateFingerprints = new Map<string, string>();
const chunkSize = 1024 * 1024;
// Bounded reads: large videos/archives never need to fit in memory for comparison.
export async function filesIdentical(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  for (let offset = 0; offset < a.size; offset += chunkSize) {
    const [left, right] = await Promise.all([a.slice(offset, offset + chunkSize).arrayBuffer(), b.slice(offset, offset + chunkSize).arrayBuffer()]);
    const x = new Uint8Array(left), y = new Uint8Array(right);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}
async function fingerprint(file: Blob): Promise<string> {
  const sample = 65536;
  const bytes = await new Blob([file.slice(0, sample), file.slice(Math.max(0, Math.floor(file.size / 2) - sample / 2), Math.floor(file.size / 2) + sample / 2), file.slice(Math.max(0, file.size - sample))]).arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export class IdenticalFileIndex {
  private sizes = new Map<number, FileCandidate[]>();
  private fingerprints = new Map<FileCandidate, string>();
  constructor(private readonly namespace?: string) {}
  add(file: FileCandidate): void { const group = this.sizes.get(file.bytes) || []; group.push(file); this.sizes.set(file.bytes, group); }
  async match(file: Blob): Promise<FileReference | null> {
    const candidates = this.sizes.get(file.size); if (!candidates) return null;
    const key = await fingerprint(file);
    for (const candidate of candidates) {
      let saved: Blob;
      try { saved = await candidate.read(); }
      catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') continue; throw error; }
      if (saved.size !== file.size) continue;
      const modified = (saved as File).lastModified;
      const cacheKey = this.namespace && Number.isFinite(modified) ? JSON.stringify([this.namespace, candidate.id, candidate.path, saved.size, modified]) : undefined;
      let candidateKey = cacheKey ? candidateFingerprints.get(cacheKey) : this.fingerprints.get(candidate);
      if (!candidateKey) {
        candidateKey = await fingerprint(saved); this.fingerprints.set(candidate, candidateKey);
        if (cacheKey) { candidateFingerprints.set(cacheKey, candidateKey); if (candidateFingerprints.size > 4096) candidateFingerprints.delete(candidateFingerprints.keys().next().value!); }
      }
      // Fingerprints only find candidates. A complete byte comparison establishes equality.
      if (candidateKey === key && await filesIdentical(file, saved)) return { id: candidate.id, path: candidate.path };
    }
    return null;
  }
}
