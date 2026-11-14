import type { CreatorLibrary, CreatorLibraryStatus, CreatorRecord, LibraryBatch, LibraryMode } from '../services/posts/library';

export type FolderAccess = PermissionState | 'missing' | 'unknown';
export const libraryMode = (library: CreatorLibrary): LibraryMode => !library.enabled ? 'off' : library.checkOnly ? 'check' : 'sync';
export const modeHelp: Record<LibraryMode, string> = {
  off: 'No automatic checks.',
  check: 'Check for updates. No downloads.',
  sync: 'Save new and changed files automatically.'
};
export function batchStatus(batch?: LibraryBatch): string {
  if (!batch) return '';
  const label = batch.status === 'stopped' ? 'Stopped' : batch.status === 'done' ? 'Done' : batch.action === 'check' ? 'Checking' : 'Syncing';
  return `${label} ${batch.completed}/${batch.total}${batch.failed ? ` · ${batch.failed} failed` : ''}`;
}
export function creatorScope(creator: CreatorRecord): string {
  if (creator.source.postId) return `Post ${creator.source.postId}`;
  return creator.selectedPostIds ? `${creator.selectedPostIds.length} selected posts` : 'All posts';
}
export function folderAccess(access: FolderAccess): { text: string; action?: string } {
  switch (access) {
    case 'granted': return { text: '' };
    case 'prompt': case 'denied': return { text: 'Needs permission', action: 'Allow access' };
    case 'missing': return { text: 'Folder disconnected', action: 'Reconnect' };
    default: return { text: 'Access unknown', action: 'Check access' };
  }
}
export function creatorStatus(creator: CreatorRecord, run?: CreatorLibraryStatus['runs'][string]): { title: string; detail: string; tone: 'normal' | 'attention' | 'active' } {
  if (run?.status === 'scanning') return { title: 'Scanning', detail: 'Checking the full archive.', tone: 'active' };
  if (run?.status === 'downloading') return { title: 'Syncing', detail: 'Saving missing or changed files.', tone: 'active' };
  const showCheck = creator.lastAction === 'check';
  const error = showCheck ? creator.error : run?.error || creator.error;
  if (run?.status === 'paused' && error === 'Folder access restored. Waiting for current work.') return { title: 'Paused', detail: 'Access allowed. Waiting to resume.', tone: 'normal' };
  if (error && /folder access|folder permission|notallowederror/i.test(error)) return { title: 'Needs permission', detail: error, tone: 'attention' };
  if (run?.status === 'paused' && !showCheck) return { title: 'Paused', detail: error === 'Automatic sync is off.' ? 'Auto sync is off.' : error || 'Open the job to resume.', tone: 'attention' };
  if (error) return { title: /429|rate.limit/i.test(error) ? 'Rate limited' : 'Check failed', detail: error, tone: 'attention' };
  switch (creator.observation) {
    case 'recent_changed': return { title: 'New or edited posts', detail: 'Recent posts changed since the last sync.', tone: 'attention' };
    case 'weekly_due': return { title: 'Sync due', detail: 'Weekly full scan due. Recent posts unchanged.', tone: 'attention' };
    case 'recent_unchanged': return { title: 'No recent changes', detail: 'Recent posts match the saved history.', tone: 'normal' };
    case 'incomplete': return { title: 'Check incomplete', detail: 'Some posts could not be read.', tone: 'attention' };
    case 'retry_needed': return { title: 'Retry needed', detail: 'The previous sync has failed files.', tone: 'attention' };
    case 'comparison_due': return { title: 'Sync needed', detail: 'Run Sync selected for a full check.', tone: 'attention' };
    default: return creator.checkedAt
      ? { title: 'First sync needed', detail: 'No saved comparison yet. Updates are unknown.', tone: 'attention' }
      : { title: 'Not checked', detail: 'Run Check selected or Sync selected.', tone: 'normal' };
  }
}
