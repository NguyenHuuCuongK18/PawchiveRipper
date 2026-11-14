import type { ArchiveDirectory } from '../../storage/destination';
import { creatorFolder } from './media';
import { emptySync } from './sync';
import { defaultSelection } from './settings';
import { creatorNamePattern, readCreatorIndex } from './creatorSafety';
import type { PostJob } from './types';

type Creator = Pick<PostJob, 'source' | 'creatorName'>;
export async function creatorDirectory(selected: ArchiveDirectory, job: Creator): Promise<ArchiveDirectory> {
  if (creatorNamePattern.test(selected.name)) { await readCreatorIndex(selected, job.source); return selected; }
  const name = creatorFolder(job);
  try { const existing = await selected.getDirectoryHandle(name); await readCreatorIndex(existing, job.source); return existing as ArchiveDirectory; }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  const directory = await selected.getDirectoryHandle(name, { create: true });
  for await (const _entry of (directory as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> }).values()) throw new Error('The new creator folder is not empty. Choose another save location.');
  const output = await (await directory.getFileHandle('sync.json', { create: true })).createWritable();
  try { await output.write(JSON.stringify(emptySync({ ...job, selection: defaultSelection() }), null, 2)); await output.close(); }
  catch (error) { await output.abort().catch(() => {}); throw error; }
  await readCreatorIndex(directory, job.source);
  return directory as ArchiveDirectory;
}
