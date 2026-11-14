import { getJobSummaries, getPostJob, getSetting, putSetting, savePostJob } from '../../storage/database';
import { getLibrary, pauseAutomaticJobs, pauseLibraryJob, probeLibraryCreator, saveLibrary, type LibraryBatch } from './library';

const setting = 'creator-library-batch';
export async function selectLibraryCreators(selected: boolean): Promise<void> {
  if (typeof selected !== 'boolean') throw new Error('Invalid selection.');
  const library = await getLibrary();
  for (const creator of library.creators) { creator.enabled = selected; creator.nextCheckAt = 0; }
  await saveLibrary(library); if (!selected) await pauseAutomaticJobs();
}
export async function queueLibraryBatch(action: 'check' | 'sync'): Promise<LibraryBatch> {
  if (action !== 'check' && action !== 'sync') throw new Error('Choose Check or Sync.');
  if ((await getSetting<LibraryBatch>(setting))?.status === 'running') throw new Error('A batch is running. Stop it first.');
  const pending = (await getLibrary()).creators.filter(creator => creator.enabled).map(creator => creator.key);
  if (!pending.length) throw new Error('Select at least one creator.');
  const batch: LibraryBatch = { action, status: 'running', pending, total: pending.length, completed: 0, failed: 0 };
  await putSetting(setting, batch); return batch;
}
export async function stopLibraryBatch(): Promise<void> {
  const batch = await getSetting<LibraryBatch>(setting); if (!batch || batch.status !== 'running') return;
  if (batch.active?.runId) {
    const job = await getPostJob(batch.active.runId);
    if (job?.libraryManual && ['scanning', 'downloading'].includes(job.status)) await pauseLibraryJob(job, 'Batch stopped.');
  }
  batch.status = 'stopped'; batch.pending = []; batch.active = undefined; await putSetting(setting, batch);
}
function finish(batch: LibraryBatch, failed: boolean): void {
  batch.completed++; if (failed) batch.failed++; batch.active = undefined;
  if (!batch.pending.length) batch.status = 'done';
}

// Called inside the worker's serial queue. The persisted active item survives a
// restart; a blocked creator does not stop the remaining selected creators.
export async function processLibraryBatch(now = Date.now()): Promise<number | undefined> {
  const batch = await getSetting<LibraryBatch>(setting); if (!batch || batch.status !== 'running') return;
  const summaries = await getJobSummaries();
  if (batch.active?.runId) {
    const job = summaries.find(job => job.id === batch.active!.runId);
    if (job && ['scanning', 'downloading'].includes(job.status)) return 1200;
    const record = (await getLibrary()).creators.find(creator => creator.key === batch.active!.key);
    finish(batch, job?.status !== 'finished' || !!record?.error); await putSetting(setting, batch);
    if (batch.status !== 'running') return;
  }
  if (summaries.some(job => ['scanning', 'downloading'].includes(job.status) || ['building', 'saving'].includes(job.archiveState || ''))) return 1200;
  const library = await getLibrary(), cooldowns = await getSetting<Record<string, number>>('host-cooldowns') || {};
  if (!batch.active) {
    const index = batch.pending.findIndex(key => {
      const creator = library.creators.find(creator => creator.key === key);
      return !creator || !(cooldowns[creator.source.origin] > now);
    });
    if (index < 0) return 30000;
    batch.active = { key: batch.pending.splice(index, 1)[0] }; await putSetting(setting, batch);
  }
  const creator = library.creators.find(creator => creator.key === batch.active!.key);
  if (!creator) { finish(batch, true); await putSetting(setting, batch); return batch.status === 'running' ? 1200 : undefined; }
  const previous = batch.action === 'sync' && creator.runId ? await getPostJob(creator.runId) : undefined;
  if (previous?.automatic && previous.status === 'paused') {
    try {
      previous.libraryManual = true; await savePostJob(previous);
      creator.error = undefined; await saveLibrary(library);
      batch.active.runId = previous.id; await putSetting(setting, batch);
      const { postCommand } = await import('./controller');
      await postCommand({ type: 'POST_ACTION', jobId: previous.id, action: 'resume' });
    } catch (error) {
      creator.error = error instanceof Error ? error.message : 'Sync failed.'; await saveLibrary(library); finish(batch, true);
    }
  } else {
    const result = await probeLibraryCreator(library, creator, now, { checkOnly: batch.action === 'check', forceFull: batch.action === 'sync', manual: true });
    if (result.runId) batch.active.runId = result.runId; else finish(batch, !!result.failed);
  }
  await putSetting(setting, batch); return batch.status === 'running' ? 1200 : undefined;
}
