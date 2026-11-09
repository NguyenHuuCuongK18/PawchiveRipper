import { postRelativePath } from './media';
import { syncKey } from './sync';
import type { PostDuplicate, PostJob, PostTask } from './types';

// The archive's content-addressed hash identifies identical source bytes. Quality remains separate.
export function attachmentKey(id: string, quality: string): string | null {
  const hash = /\/([a-f0-9]{64})(?:\.[a-z0-9_-]{1,16})?(?::extract:\d+)?$/i.exec(id)?.[1];
  return hash && !id.includes(':extract:') ? `${quality}:${hash.toLowerCase()}` : null;
}
export function planDuplicates(tasks: PostTask[], enabled: boolean): { tasks: PostTask[]; duplicates: PostDuplicate[] } {
  if (!enabled) return { tasks, duplicates: [] };
  const kept: PostTask[] = [], duplicates: PostDuplicate[] = [], seen = new Map<string, PostTask>();
  for (const task of tasks) {
    const key = task.kind !== 'text' && task.url ? attachmentKey(task.id, task.quality) : null;
    const previous = key ? seen.get(key) : undefined;
    if (!previous) { kept.push(task); if (key) seen.set(key, task); continue; }
    if (task.url !== previous.url) previous.alternateUrls = [...new Set([...(previous.alternateUrls || []), task.url!])];
    duplicates.push({ postId: task.postId, path: postRelativePath(task), duplicateOf: postRelativePath(previous), keptTaskId: previous.id });
  }
  return { tasks: kept, duplicates };
}
export function duplicateReport(job: PostJob) {
  const tasks = new Map(job.tasks.map(task => [syncKey(task.id), task]));
  const report = (job.duplicates || []).map(item => {
    const kept = tasks.get(syncKey(item.keptTaskId)) || tasks.get(syncKey(item.keptTaskId.replace(':full res:', ':thumbnail:')));
    const saved = item.existing || kept && ['staged', 'downloaded'].includes(kept.status);
    return { postId: item.postId, path: item.path, duplicateOf: kept ? postRelativePath(kept) : item.duplicateOf,
      bytes: kept?.bytes ?? item.bytes ?? null, reason: 'identical-attachment', status: saved ? 'saved' : 'unavailable', ...(item.retainedPaths ? { retainedPaths: item.retainedPaths } : {}) };
  });
  for (const task of job.tasks) for (const file of task.extraction?.files || []) if (file.duplicateOf) {
    report.push({ postId: task.postId, path: file.path, duplicateOf: file.duplicateOf.path, bytes: file.bytes, reason: 'identical-extracted-file', status: 'saved' });
  }
  return report;
}
