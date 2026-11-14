import { expect, it } from 'vitest';
import { batchStatus, creatorScope, creatorStatus, folderAccess, libraryMode, modeHelp } from '../src/ui/libraryPresentation';
import type { CreatorRecord } from '../src/services/posts/library';
const creator: CreatorRecord = { key: 'creator', source: { origin: 'https://pawchive.pw', platform: 'fanbox', creatorId: '123', postId: null }, creatorName: 'Creator', directoryId: 'folder', folderName: 'fanbox_123_Creator', selection: { quality: 'full res', images: true, files: true, text: true }, enabled: true, checkedAt: 0, fullCheckedAt: 0, syncedAt: 0, nextCheckAt: 0 };
it('never labels an unverified import as confirmed updates or a verified archive', () => {
  expect(creatorStatus(creator).title).toBe('Not checked');
  const status = creatorStatus({ ...creator, checkedAt: 1, observation: 'initial_comparison' });
  expect(status.title).toBe('First sync needed'); expect(status.detail).toContain('Updates are unknown');
});
it('explains the limits of a successful quick check and a weekly deadline separately', () => {
  expect(creatorStatus({ ...creator, observation: 'recent_unchanged' }).title).toBe('No recent changes');
  expect(creatorStatus({ ...creator, observation: 'weekly_due' }).detail).toContain('Weekly full scan due');
  expect(creatorStatus({ ...creator, observation: 'recent_changed' }).title).toBe('New or edited posts');
});
it('shows active work and the actual pause reason instead of stale quick-check findings', () => {
  const changed = { ...creator, observation: 'recent_changed' as const };
  expect(creatorStatus(changed, { status: 'scanning' }).title).toBe('Scanning');
  expect(creatorStatus(changed, { status: 'downloading' }).title).toBe('Syncing');
  expect(creatorStatus(changed, { status: 'paused', error: 'Folder access expired.' }).title).toBe('Needs permission');
  expect(creatorStatus(changed, { status: 'paused', error: 'Folder access expired.' }).detail).toBe('Folder access expired.');
});
it('offers permission actions only when permission is needed or unknown', () => {
  expect(folderAccess('granted').action).toBeUndefined();
  expect(folderAccess('prompt').action).toBe('Allow access'); expect(folderAccess('denied').action).toBe('Allow access');
  expect(folderAccess('missing').action).toBe('Reconnect'); expect(folderAccess('unknown').text).toBe('Access unknown');
});
it('explains a mode-change pause without implying that recent-post checks are disabled', () => {
  const status = creatorStatus(creator, { status: 'paused', error: 'Automatic sync is off.' });
  expect(status.title).toBe('Paused'); expect(status.detail).toBe('Auto sync is off.');
});
it('describes the effective mode and preserves single-post and selected-post scope', () => {
  expect(libraryMode({ enabled: false, checkOnly: true, creators: [] })).toBe('off');
  expect(libraryMode({ enabled: true, checkOnly: true, creators: [] })).toBe('check');
  expect(libraryMode({ enabled: true, creators: [] })).toBe('sync'); expect(modeHelp.check).toContain('No downloads');
  expect(creatorScope(creator)).toBe('All posts'); expect(creatorScope({ ...creator, source: { ...creator.source, postId: '100' } })).toBe('Post 100');
  expect(creatorScope({ ...creator, selectedPostIds: ['1', '2'] })).toBe('2 selected posts');
});
it('keeps routine status labels short and does not report failed items as synced', () => {
  for (const observation of ['initial_comparison', 'recent_changed', 'weekly_due', 'recent_unchanged', 'incomplete', 'retry_needed', 'comparison_due'] as const) expect(creatorStatus({ ...creator, observation }).title.length).toBeLessThanOrEqual(24);
  expect(batchStatus({ action: 'sync', status: 'done', pending: [], total: 4, completed: 4, failed: 1 })).toBe('Done 4/4 · 1 failed');
});
it('shows a fresh check result while an older job is paused, and keeps active work visible', () => {
  const checked = { ...creator, lastAction: 'check' as const, observation: 'recent_unchanged' as const };
  expect(creatorStatus(checked, { status: 'paused', error: 'Automatic sync is off.' }).title).toBe('No recent changes');
  expect(creatorStatus(checked, { status: 'downloading' }).title).toBe('Syncing');
});
it('does not report a renewed grant as still needing permission while the job waits to resume', () => {
  const status = creatorStatus(creator, { status: 'paused', error: 'Folder access restored. Waiting for current work.' });
  expect(status.title).toBe('Paused'); expect(status.detail).toBe('Access allowed. Waiting to resume.');
});
