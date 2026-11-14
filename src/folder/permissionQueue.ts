import { getDirectory, type ArchiveDirectory } from '../storage/destination';
import { assertCreatorName, readCreatorIndex } from '../services/posts/creatorSafety';
import { needsFirstSync, type CreatorRecord } from '../services/posts/library';

export interface PermissionFolder { creator: CreatorRecord; handle: ArchiveDirectory }
export interface PermissionIssue { name: string; reason: string }
export function assertPermissionFolder(folder: PermissionFolder): void {
  assertCreatorName(folder.creator.folderName, folder.creator.source);
  assertCreatorName(folder.handle.name, folder.creator.source);
  if (folder.handle.name !== folder.creator.folderName) throw new Error('Folder connection changed. Reconnect it.');
}
export async function firstSyncPermissionQueue(creators: CreatorRecord[]): Promise<{ folders: PermissionFolder[]; issues: PermissionIssue[] }> {
  const folders: PermissionFolder[] = [], issues: PermissionIssue[] = [];
  const candidates = creators.filter(creator => creator.enabled && needsFirstSync(creator)).sort((a, b) => a.creatorName.localeCompare(b.creatorName) || a.key.localeCompare(b.key));
  for (const creator of candidates) {
    try {
      const handle = await getDirectory(creator.directoryId);
      if (!handle) throw new Error('Folder disconnected.');
      const folder = { creator, handle }; assertPermissionFolder(folder);
      if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') continue;
      // Validate current metadata before prompting whenever read access is still
      // available. Otherwise revalidate immediately after the explicit grant.
      if (await handle.queryPermission({ mode: 'read' }) === 'granted') await readCreatorIndex(handle, creator.source);
      folders.push(folder);
    } catch (error) { issues.push({ name: creator.creatorName, reason: error instanceof Error ? error.message : 'Folder unavailable.' }); }
  }
  return { folders, issues };
}

// This function must be invoked directly from a top-level button's click handler.
// No async storage lookup may precede the browser's permission request.
export function requestFolderPermission(folder: PermissionFolder): Promise<PermissionState> {
  assertPermissionFolder(folder);
  return folder.handle.requestPermission({ mode: 'readwrite' });
}
