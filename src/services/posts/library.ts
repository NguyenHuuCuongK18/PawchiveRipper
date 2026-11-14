import { getPostJobs, getJobSummaries, getSetting, putSetting, savePostJob, getPostJob, type JobSummary } from '../../storage/database';
import { offscreen } from '../../background/offscreenBridge';
import { parsePostUrl, postSourceUrl, supportedSite } from '../registry';
import { creatorNamePattern } from './creatorSafety';
import { PostClient } from './client';
import { RequestError } from '../../api/kemonoClient';
import { normalizePost } from './media';
import type { PostJob, PostScope, PostSelection, ArchivedPost } from './types';

export const CHECK_INTERVAL = 30 * 60_000, FULL_INTERVAL = 7 * 24 * 60 * 60_000;
export type LibraryMode = 'off' | 'check' | 'sync';
export type ProbeResult = 'initial_comparison' | 'recent_changed' | 'weekly_due' | 'recent_unchanged' | 'incomplete' | 'retry_needed' | 'comparison_due';
const legacyCheckNotice = 'Updates or a full check are due. Turn off check-only mode to save them.';
export interface CreatorRecord {
  key: string; source: PostScope; creatorName: string; directoryId: string; folderName: string;
  selection: PostSelection; selectedPostIds?: string[]; enabled: boolean;
  checkedAt: number; fullCheckedAt: number; syncedAt: number; nextCheckAt: number;
  head?: string; runId?: string; error?: string; observation?: ProbeResult; lastAction?: 'check' | 'sync';
}
export interface CreatorLibrary { enabled: boolean; checkOnly?: boolean; creators: CreatorRecord[] }
export const needsFirstSync = (creator: CreatorRecord): boolean => !creator.head || !creator.fullCheckedAt;
export const needsFirstSyncAccess = (creator: CreatorRecord, access: string): boolean => creator.enabled && needsFirstSync(creator) && (access === 'prompt' || access === 'denied');
export interface LibraryBatch {
  action: 'check' | 'sync'; status: 'running' | 'done' | 'stopped'; pending: string[];
  active?: { key: string; runId?: string }; total: number; completed: number; failed: number;
}
export interface CreatorLibraryStatus extends CreatorLibrary { runs: Record<string, Pick<JobSummary, 'status' | 'error'>>; batch?: LibraryBatch }
export const creatorKey = (source: PostScope) => `${source.origin}/${source.platform}/${source.creatorId}`;
export async function getLibrary(): Promise<CreatorLibrary> {
  const library = await getSetting<CreatorLibrary>('creator-library') || { enabled: false, creators: [] };
  // Older builds stored an ambiguous check-only notice as an error. It was not
  // evidence of an update, so do not invent a more specific result on migration.
  for (const creator of library.creators) if (creator.error === legacyCheckNotice) {
    creator.error = undefined;
    creator.observation ||= needsFirstSync(creator) ? 'initial_comparison' : 'comparison_due';
  }
  return library;
}
export const saveLibrary = (library: CreatorLibrary) => putSetting('creator-library', library);
export async function libraryStatus(): Promise<CreatorLibraryStatus> {
  const library = await getLibrary(), ids = new Set(library.creators.map(creator => creator.runId));
  const runs = Object.fromEntries((await getJobSummaries()).filter(job => ids.has(job.id)).map(job => [job.id, { status: job.status, error: job.error }]));
  return { ...library, runs, batch: await getSetting<LibraryBatch>('creator-library-batch') };
}
export async function findCreator(source: PostScope): Promise<CreatorRecord | undefined> { return (await getLibrary()).creators.find(item => item.key === creatorKey(source)); }
export async function rememberCreator(job: PostJob): Promise<void> {
  if (job.destination?.kind !== 'folder' || !job.destination.directoryId || !creatorNamePattern.test(job.destination.name)) return;
  const directoryId = job.destination.directoryId;
  const library = await getLibrary(), key = creatorKey(job.source), previous = library.creators.find(item => item.key === key && item.directoryId === directoryId);
  // Visiting one post must not narrow a registered full-creator subscription.
  const source = previous?.source.postId === null ? previous.source : job.source;
  const record: CreatorRecord = { key, source, creatorName: job.creatorName, directoryId: job.destination.directoryId, folderName: job.destination.name,
    selection: job.selection, selectedPostIds: previous && job.source.postId ? previous.selectedPostIds : job.selectedPostIds,
    enabled: previous?.enabled || false, checkedAt: previous?.checkedAt || 0, fullCheckedAt: previous?.fullCheckedAt || 0,
    syncedAt: previous?.syncedAt || 0, nextCheckAt: previous?.nextCheckAt || 0, head: previous?.head, runId: previous?.runId, error: previous?.error, observation: previous?.observation, lastAction: previous?.lastAction };
  library.creators = [...library.creators.filter(item => item.key !== key), record]; await saveLibrary(library);
}
export async function migrateCreatorJobs(): Promise<void> {
  if (await getSetting<boolean>('creator-library-migrated')) return;
  const summaries = (await getJobSummaries()).filter(job => job.service === 'posts' && job.destinationKind !== 'zip').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const summary of summaries) { const job = await getPostJob(summary.id); if (job) await rememberCreator(job); }
  await putSetting('creator-library-migrated', true);
}
export async function setAutoSync(enabled: boolean, key?: string): Promise<CreatorLibrary> {
  if (typeof enabled !== 'boolean') throw new Error('Choose whether automatic sync is enabled.');
  const library = await getLibrary();
  if (key !== undefined) { const record = library.creators.find(item => item.key === key); if (!record) throw new Error('Connect this creator folder first.'); record.enabled = enabled; record.nextCheckAt = 0; }
  else library.enabled = enabled;
  await saveLibrary(library);
  if (!enabled) await pauseAutomaticJobs(key);
  return library;
}
export async function setLibraryMode(mode: LibraryMode): Promise<CreatorLibrary> {
  if (!['off', 'check', 'sync'].includes(mode)) throw new Error('Choose Off, Check only, or Check and save.');
  if (mode !== 'sync') await pauseAutomaticJobs();
  const library = await getLibrary(); library.enabled = mode !== 'off'; library.checkOnly = mode === 'check';
  for (const creator of library.creators) creator.nextCheckAt = 0;
  await saveLibrary(library); return library;
}
export async function pauseAutomaticJobs(key?: string): Promise<void> {
  for (const job of await getPostJobs(['scanning', 'downloading'])) if (job.automatic && !job.libraryManual && (key === undefined || creatorKey(job.source) === key)) await pauseLibraryJob(job, 'Automatic sync is off.');
}
export async function pauseLibraryJob(job: PostJob, reason: string): Promise<void> {
  await offscreen('post-transfer-stop', { jobId: job.id });
  for (const task of job.tasks) { if (task.status === 'transferring') task.status = 'queued'; if (task.extraction?.state === 'extracting') task.extraction = { state: 'pending', files: [] }; }
  job.resumeStatus = job.status as 'scanning' | 'downloading'; job.status = 'paused'; job.error = reason; await savePostJob(job);
}
export async function postFingerprint(post: ArchivedPost): Promise<string> {
  const value = JSON.stringify([post.id, post.title, post.content, post.published, post.hasFull, post.embed, post.media.map(media => [media.path, media.name, media.kind])]);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function headFingerprint(posts: ArchivedPost[]): Promise<string> { return JSON.stringify(await Promise.all(posts.map(post => postFingerprint(post)))); }

export async function completeLibraryRun(job: PostJob): Promise<void> {
  if (!job.automatic || job.destination?.kind !== 'folder') return;
  const library = await getLibrary(), record = library.creators.find(item => item.key === creatorKey(job.source));
  if (!record || record.runId !== job.id) return;
  const complete = !job.scan.failures?.length;
  if (complete) { record.head = job.probeHead || await headFingerprint(job.posts.slice(0, 50)); record.fullCheckedAt = Date.now(); record.observation = 'recent_unchanged'; }
  record.syncedAt = Date.now();
  record.lastAction = 'sync';
  const issues = [
    [job.tasks.filter(task => task.status === 'failed').length, 'failed file'],
    [job.tasks.filter(task => task.status === 'unavailable').length, 'unavailable file'],
    [job.tasks.filter(task => task.extraction?.state === 'failed').length, 'failed extraction'],
    [job.scan.failures?.length || 0, 'unreadable page/post']
  ] as const;
  const details = issues.filter(([count]) => count).map(([count, label]) => `${count} ${label}${count === 1 ? '' : 's'}`);
  record.error = details.length ? `${details.join(', ')}. Retry failed items.` : undefined;
  await saveLibrary(library);
}

// Called from the existing serial mutation queue. One due creator per wakeup;
// fast probes never pause or replace an active manual job.
export async function checkCreatorLibrary(url?: string, now = Date.now()): Promise<void> {
  const library = await getLibrary(); if (!library.enabled) return;
  if ((await getSetting<LibraryBatch>('creator-library-batch'))?.status === 'running') return;
  if (url && !supportedSite(url)) return;
  if (!url && !(await chrome.tabs.query({ url: ['https://pawchive.pw/*', 'https://kemono.cr/*'] })).length) return;
  if ((await getJobSummaries()).some(job => ['scanning', 'downloading'].includes(job.status) || ['building', 'saving'].includes(job.archiveState || ''))) return;
  const scope = url ? parsePostUrl(url) : null;
  const cooldowns = await getSetting<Record<string, number>>('host-cooldowns') || {};
  const due = library.creators.filter(item => item.enabled && item.nextCheckAt <= now && !(cooldowns[item.source.origin] > now)).sort((a, b) => Number(!!scope && b.key === creatorKey(scope)) - Number(!!scope && a.key === creatorKey(scope)) || a.nextCheckAt - b.nextCheckAt)[0];
  if (!due) return;
  const previous = due.runId ? await getPostJob(due.runId) : undefined;
  if (previous?.status === 'paused' && !library.checkOnly) {
    due.nextCheckAt = now + CHECK_INTERVAL; due.error = previous.error || 'Automatic sync is paused.'; await saveLibrary(library);
    if (previous.error === 'Automatic sync is off.' || previous.error === 'Folder access restored. Waiting for current work.') {
      try { const { postCommand } = await import('./controller'); await postCommand({ type: 'POST_ACTION', jobId: previous.id, action: 'resume' }); }
      catch (error) { due.error = error instanceof Error ? error.message : 'Could not resume automatic sync.'; await saveLibrary(library); }
    }
    return;
  }
  due.nextCheckAt = now + CHECK_INTERVAL; await saveLibrary(library);
  await probeLibraryCreator(library, due, now, { checkOnly: !!library.checkOnly });
}

// Scheduled probes and explicit bulk actions share the same identity checks.
export async function probeLibraryCreator(library: CreatorLibrary, due: CreatorRecord, now: number, options: { checkOnly: boolean; forceFull?: boolean; manual?: boolean }): Promise<{ runId?: string; failed?: boolean }> {
  const previous = due.runId ? await getPostJob(due.runId) : undefined;
  due.lastAction = options.checkOnly ? 'check' : 'sync';
  due.nextCheckAt = now + CHECK_INTERVAL;
  try {
    const client = new PostClient();
    const page = due.source.postId ? { posts: [await client.post(due.source)], failures: [] } : await client.page(due.source, 0);
    const raw = page.posts;
    const head = await headFingerprint(raw.map(post => normalizePost(post, due.source)));
    due.checkedAt = now; due.error = undefined;
    due.observation = page.failures.length ? 'incomplete' : needsFirstSync(due) ? 'initial_comparison'
      : head !== due.head ? 'recent_changed' : now - due.fullCheckedAt >= FULL_INTERVAL ? 'weekly_due'
      : previous?.tasks.some(task => task.status === 'failed') ? 'retry_needed' : 'recent_unchanged';
    if (options.checkOnly || !options.forceFull && due.observation === 'recent_unchanged') { await saveLibrary(library); return {}; }
    // Confirm access and archive identity before starting any media transfer.
    const sync = await offscreen<import('./types').PostSyncIndex>('post-folder-read', { directoryId: due.directoryId, postJob: { source: due.source } });
    const id = crypto.randomUUID();
    const job: PostJob = { id, service: 'posts', automatic: true, libraryManual: options.manual, probeHead: head, source: due.source, sourceUrl: postSourceUrl(due.source), creatorName: due.creatorName,
      createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), status: 'scanning', resumeStatus: 'scanning',
      selection: { ...due.selection, keepArchives: true }, selectedPostIds: due.selectedPostIds, posts: [], tasks: [], detailQueue: [], archive: undefined,
      scan: { offset: 0, pages: 0, total: due.source.postId ? 1 : null, complete: false, error: null, attempts: 0, nextAt: 0, fingerprints: [], mediaVersion: 1 },
      destination: { kind: 'folder', directoryId: due.directoryId, name: due.folderName }, sync, autoDownload: { ...due.selection, keepArchives: true }, nextAt: 0, error: null };
    await savePostJob(job); due.runId = id; await saveLibrary(library); return { runId: id };
  } catch (error) {
    due.error = error instanceof Error ? error.message : 'Automatic check failed.';
    if (error instanceof RequestError && error.status === 429) {
      const until = now + Math.max(CHECK_INTERVAL, error.retryAfterMs);
      const cooldowns = await getSetting<Record<string, number>>('host-cooldowns') || {};
      due.nextCheckAt = Math.max(due.nextCheckAt, until); cooldowns[due.source.origin] = Math.max(cooldowns[due.source.origin] || 0, until);
      await putSetting('host-cooldowns', cooldowns);
    }
    await saveLibrary(library); return { failed: true };
  }
}
