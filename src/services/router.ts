import type { Command } from '../core/types';
import { command as discordCommand } from './discord';
import { getJob, getJobs, getJobSummaries, saveJob } from '../storage/database';
import { pausePosts, postCommand } from './posts/controller';
import type { PostCommand } from './posts/types';
import { supportedSite } from './registry';
import { clearLocalData, type ClearLocalData } from './localData';
import { cacheList, cacheSettings, removeJobCache, type CacheCommand, type CacheSettingsCommand } from './cacheMaintenance';
import { getLibrary, libraryStatus, saveLibrary, setAutoSync, setLibraryMode, pauseAutomaticJobs, checkCreatorLibrary, migrateCreatorJobs, rememberCreator, needsFirstSync, type LibraryMode } from './posts/library';
import { getPostJob, savePostJob } from '../storage/database';
import { parsePostUrl } from './registry';
import type { PostSelection, PostJob } from './posts/types';
import { offscreen } from '../background/offscreenBridge';
import { selectLibraryCreators, queueLibraryBatch, stopLibraryBatch } from './posts/libraryBatch';

export type LibraryCommand = { type: 'LIBRARY_STATUS' } | { type: 'LIBRARY_SELECT'; selected: boolean } | { type: 'LIBRARY_BATCH'; action: 'check' | 'sync' } | { type: 'LIBRARY_STOP' } | { type: 'LIBRARY_MODE'; mode: LibraryMode } | { type: 'LIBRARY_AUTO'; enabled: boolean; key?: string } | { type: 'LIBRARY_CHECK_ONLY'; enabled: boolean } | { type: 'LIBRARY_REAUTHORIZE'; key: string } | { type: 'LIBRARY_FIRST_SYNC_ACCESS'; key: string } | { type: 'SITE_VISIT'; url: string } | { type: 'LIBRARY_REGISTER'; url: string; directoryId: string; name: string; creatorName: string; selection: PostSelection; selectedPostIds?: string[] };

export interface PageContext { url: string; expectedPosts: number | null }
export type ServiceCommand = Command | PostCommand | ClearLocalData | CacheSettingsCommand | CacheCommand | LibraryCommand | { type: 'PAGE_CONTEXT' } | { type: 'SERVICE_JOBS' } | { type: 'DISCORD_DOWNLOAD'; jobId: string; quality: 'thumbnail' | 'full res' | 'best' };
export function isReadOnlyCommand(message: ServiceCommand): boolean {
  return ['PAGE_CONTEXT', 'SERVICE_JOBS', 'DETAIL', 'POST_DETAIL', 'LOCAL_STATUS', 'CACHE_LIST'].includes(message.type);
}
export async function route(message: ServiceCommand, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const folderPage = sender.id === chrome.runtime.id && sender.tab?.url?.split('#')[0] === chrome.runtime.getURL('folder/index.html');
  if (sender.tab?.url && !supportedSite(sender.tab.url) && !folderPage) throw new Error('Pawchive Ripper works only on Kemono and Pawchive.');
  if (message.type === 'LIBRARY_STATUS') { await migrateCreatorJobs(); return libraryStatus(); }
  if (message.type === 'LIBRARY_SELECT') return selectLibraryCreators(message.selected);
  if (message.type === 'LIBRARY_BATCH') return queueLibraryBatch(message.action);
  if (message.type === 'LIBRARY_STOP') return stopLibraryBatch();
  if (message.type === 'LIBRARY_MODE') return setLibraryMode(message.mode);
  if (message.type === 'LIBRARY_AUTO') return setAutoSync(message.enabled, message.key);
  if (message.type === 'LIBRARY_CHECK_ONLY') {
    if (typeof message.enabled !== 'boolean') throw new Error('Invalid check-only setting.');
    if (message.enabled) await pauseAutomaticJobs();
    const library = await getLibrary(); library.checkOnly = message.enabled; for (const creator of library.creators) creator.nextCheckAt = 0;
    await saveLibrary(library); return library;
  }
  if (message.type === 'LIBRARY_FIRST_SYNC_ACCESS') {
    if (!folderPage) throw new Error('Allow access from the folder permission page.');
    const library = await getLibrary(), creator = library.creators.find(item => item.key === message.key);
    if (!creator || !creator.enabled || !needsFirstSync(creator)) return false;
    await offscreen('post-folder-read', { directoryId: creator.directoryId, postJob: { source: creator.source } });
    creator.error = undefined; creator.nextCheckAt = 0;
    const pending = creator.runId ? await getPostJob(creator.runId) : undefined;
    if (pending?.automatic && pending.status === 'paused' && pending.error?.startsWith('Folder access is required.')) {
      pending.error = 'Folder access restored. Waiting for current work.'; await savePostJob(pending);
    }
    await saveLibrary(library); return true;
  }
  if (message.type === 'LIBRARY_REAUTHORIZE') {
    if (!folderPage) throw new Error('Restore access from the folder access page.');
    const library = await getLibrary(), creator = library.creators.find(item => item.key === message.key);
    if (!creator) throw new Error('This creator is no longer registered.');
    await offscreen('post-folder-read', { directoryId: creator.directoryId, postJob: { source: creator.source } });
    creator.error = undefined; creator.nextCheckAt = 0;
    const pending = creator.runId && await getPostJob(creator.runId);
    if (pending && pending.status === 'paused' && library.enabled && creator.enabled && !library.checkOnly) {
      pending.error = 'Folder access restored. Waiting for current work.'; await savePostJob(pending);
      if (!(await getJobSummaries()).some(job => ['scanning', 'downloading'].includes(job.status) || ['building', 'saving'].includes(job.archiveState || ''))) await postCommand({ type: 'POST_ACTION', jobId: pending.id, action: 'resume' });
    }
    await saveLibrary(library); return null;
  }
  if (message.type === 'SITE_VISIT') {
    if (!supportedSite(message.url) || sender.tab?.url && sender.tab.url !== message.url) throw new Error('Invalid site visit.');
    await checkCreatorLibrary(message.url); return null;
  }
  if (message.type === 'LIBRARY_REGISTER') {
    if (!folderPage) throw new Error('Import archives from the folder access page.');
    const source = parsePostUrl(message.url); if (!source || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.directoryId)) throw new Error('Invalid creator registration.');
    if (message.selectedPostIds !== undefined && (!Array.isArray(message.selectedPostIds) || message.selectedPostIds.length > 100000 || message.selectedPostIds.some(id => typeof id !== 'string' || !/^(?:p-)?\d{1,40}$/.test(id)))) throw new Error('Invalid selected archive scope.');
    const index = await offscreen<import('./posts/types').PostSyncIndex>('post-folder-import', { directoryId: message.directoryId, postJob: { source } });
    await rememberCreator({ source, creatorName: index.creatorName, selection: index.selection, selectedPostIds: message.selectedPostIds, destination: { kind: 'folder', directoryId: message.directoryId, name: message.name } } as PostJob);
    return null;
  }
  if (message.type === 'LOCAL_CLEAR') { await clearLocalData(message); return null; }
  if (message.type === 'LOCAL_STATUS' || message.type === 'LOCAL_SETTINGS') return cacheSettings(message);
  if (message.type === 'CACHE_LIST') return cacheList();
  if (message.type === 'CACHE_REMOVE') { await removeJobCache(message.jobId); return null; }
  if (message.type === 'PAGE_CONTEXT') {
    const tab = sender.tab?.id !== undefined ? await chrome.tabs.get(sender.tab.id) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!tab?.id || !supportedSite(tab.url || '')) return null;
    try {
      const context = await chrome.tabs.sendMessage(tab.id, { type: 'PAGE_CONTEXT' }) as PageContext;
      if (context?.url === tab.url) return context;
    } catch { /* A newly installed extension can use the tab URL before its content script is reloaded. */ }
    return { url: tab.url, expectedPosts: null };
  }
  if (message.type === 'SERVICE_JOBS') {
    return (await getJobSummaries()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (message.type.startsWith('POST_')) {
    if (message.type === 'POST_DOWNLOAD' || message.type === 'POST_SYNC_IMPORT' || message.type === 'POST_SYNC_CONNECT' || (message.type === 'POST_ACTION' && ['resume', 'retry', 'rescan', 'skip'].includes(message.action))) {
      await pausePosts();
      for (const job of await getJobs(['scanning', 'downloading'])) { job.resumeStatus = job.status as 'scanning' | 'downloading'; job.status = 'paused'; await saveJob(job); }
    }
    return postCommand(message as PostCommand);
  }
  if (message.type === 'DISCORD_DOWNLOAD') {
    const job = await getJob(message.jobId); if (!job || !['thumbnail', 'full res', 'best'].includes(message.quality)) throw new Error('Invalid Discord download.');
    if (!['indexed', 'finished'].includes(job.status)) throw new Error('Finish scanning before downloading.');
    job.mode = message.quality === 'full res' ? 'original' : message.quality;
    job.tryOriginal = message.quality === 'best'; await saveJob(job); await pausePosts();
    return discordCommand({ type: 'ACTION', jobId: job.id, action: 'download' }, sender);
  }
  if (message.type === 'START' || (message.type === 'ACTION' && ['download', 'resume', 'retry'].includes(message.action))) await pausePosts();
  return discordCommand(message as Command, sender);
}
