import { needsFirstSync, type CreatorLibrary } from '../services/posts/library';
import { readCreatorIndex } from '../services/posts/creatorSafety';
import { firstSyncPermissionQueue, requestFolderPermission } from './permissionQueue';

export async function firstSyncAccess(loadLibrary: () => Promise<CreatorLibrary>, confirm: (key: string) => Promise<unknown>): Promise<void> {
  const section = document.createElement('section'); section.id = 'first-sync-access';
  const help = document.createElement('p'), progress = document.createElement('p'), name = document.createElement('h2'), folderName = document.createElement('p'), status = document.createElement('p'), actions = document.createElement('div');
  help.className = progress.className = folderName.className = 'small muted'; help.textContent = 'Selected first-sync folders only. Click Allow for each folder.';
  progress.id = 'permission-progress'; progress.setAttribute('role', 'status'); name.id = 'permission-creator'; folderName.id = 'permission-folder'; status.id = 'permission-status'; status.setAttribute('role', 'status'); actions.className = 'actions';
  const allow = document.createElement('button'), skip = document.createElement('button');
  allow.id = 'permission-allow'; allow.type = skip.type = 'button'; allow.textContent = 'Allow folder'; skip.id = 'permission-skip'; skip.textContent = 'Skip'; allow.disabled = skip.disabled = true;
  actions.append(allow, skip); section.append(help, progress, name, folderName, status, actions); document.querySelector('main')!.append(section);
  progress.textContent = 'Checking folders…';
  const queue = await firstSyncPermissionQueue((await loadLibrary()).creators), issues = queue.issues;
  let position = 0, allowed = 0, skipped = issues.length, working = false;
  function show(): void {
    const current = queue.folders[position];
    progress.textContent = `${allowed} allowed · ${skipped} skipped · ${queue.folders.length - position} remaining`;
    name.textContent = current?.creator.creatorName || (allowed ? 'Done' : 'No folders need permission');
    folderName.textContent = current?.creator.folderName || '';
    allow.hidden = skip.hidden = !current; allow.disabled = skip.disabled = working;
  }
  async function next(): Promise<void> {
    position++;
    // Permission may be inherited or the creator may have synced while this page
    // was open. Skip those entries without issuing another permission request.
    const library = await loadLibrary();
    while (queue.folders[position]) {
      const current = queue.folders[position], latest = library.creators.find(item => item.key === current.creator.key);
      if (!latest || !latest.enabled || !needsFirstSync(latest) || latest.directoryId !== current.creator.directoryId) { skipped++; position++; continue; }
      if (await current.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') break;
      position++;
    }
    show();
  }
  function reportIssues(): void {
    if (!issues.length) return;
    let details = section.querySelector<HTMLDetailsElement>('details');
    if (!details) { details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Skipped folders'; details.append(summary); section.append(details); }
    details.querySelector('ul')?.remove(); const list = document.createElement('ul');
    for (const issue of issues) { const row = document.createElement('li'); row.textContent = `${issue.name}: ${issue.reason}`; list.append(row); }
    details.append(list);
  }
  allow.onclick = () => {
    const current = queue.folders[position]; if (!current || working) return;
    // Invoke synchronously before any await so transient user activation is kept.
    let request: Promise<PermissionState>;
    try { request = requestFolderPermission(current); } catch (error) { status.textContent = error instanceof Error ? error.message : 'Permission request failed.'; return; }
    working = true; show(); status.textContent = 'Waiting for permission…';
    void (async () => {
      const permission = await request;
      if (permission !== 'granted') { status.textContent = 'Not allowed. Try again or Skip.'; return; }
      try {
        await readCreatorIndex(current.handle, current.creator.source);
        await confirm(current.creator.key); allowed++; status.textContent = 'Access allowed.';
      } catch (error) {
        skipped++; issues.push({ name: current.creator.creatorName, reason: error instanceof Error ? error.message : 'Archive validation failed.' }); status.textContent = 'Invalid archive. Skipped.'; reportIssues();
      }
      await next();
    })().catch(error => { status.textContent = error instanceof DOMException && error.name === 'AbortError' ? 'Cancelled. Try again or Skip.' : error instanceof Error ? error.message : 'Permission request failed.'; }).finally(() => { working = false; show(); });
  };
  skip.onclick = () => {
    if (working || !queue.folders[position]) return;
    working = true; skipped++; status.textContent = 'Skipped.'; show();
    void next().catch(error => { status.textContent = String(error); }).finally(() => { working = false; show(); });
  };
  show(); reportIssues();
}
