import { describe, expect, it } from 'vitest';
import { createTasks, normalizePost } from '../src/services/posts/media';
import { attachmentKey, duplicateReport, planDuplicates } from '../src/services/posts/duplicates';
import { filesIdentical, IdenticalFileIndex } from '../src/services/posts/identicalFiles';
import { defaultSelection, validSelection } from '../src/services/posts/settings';
import { emptySync, parseSync, recordSaved, syncKey } from '../src/services/posts/sync';
import type { PostJob, PostTask } from '../src/services/posts/types';

const source = { origin: 'https://pawchive.pw', platform: 'fanbox' as const, creatorId: '540245', postId: null };
const path = '/2aa/bb/' + 'a'.repeat(64) + '.zip';
const makeJob = () => ({ source, creatorName: 'Creator', destination: { kind: 'folder', directoryId: 'test', name: 'test' }, selection: defaultSelection(),
  posts: ['100', '200'].map(id => normalizePost({ id, user: source.creatorId, service: source.platform, content: id, attachments: [{ name: id === '100' ? 'original.zip' : 'recap.zip', path: id === '100' ? path : path.replace('/2aa/', '/1aa/'), server: `https://n${id === '100' ? 1 : 2}.pawchive.pw` }] }, source)) } as PostJob);

describe('duplicate attachment planning and archive selection', () => {
  it('downloads an identical ZIP once across posts, partitions and names, retaining post text', () => {
    const job = makeJob(), raw = createTasks(job, job.selection), planned = planDuplicates(raw, true);
    expect(planned.tasks).toHaveLength(3); expect(planned.duplicates).toHaveLength(1);
    expect(planned.tasks[0].alternateUrls).toEqual([raw[2].url]);
    expect(planned.duplicates[0]).toMatchObject({ postId: '200', keptTaskId: raw[0].id });
    expect(planDuplicates(raw, false).tasks).toHaveLength(4);
  });
  it('keeps different archive hashes even when their names are identical or differ only by language', () => {
    const job = makeJob(); job.posts[1].media[0].path = path.replaceAll('a', 'c');
    job.posts[1].media[0].id = '1:' + job.posts[1].media[0].path;
    job.posts[1].media[0].name = 'original-ZH.zip';
    expect(planDuplicates(createTasks(job, job.selection), true).duplicates).toEqual([]);
    job.posts[1].media[0].name = 'original.zip';
    expect(planDuplicates(createTasks(job, job.selection), true).duplicates).toEqual([]);
  });
  it('honors archive exclusions before any transfer and does not exclude another post or its text', () => {
    const job = makeJob(), excludedAttachmentIds = [`100:${path}`];
    const tasks = createTasks(job, { ...job.selection, excludedAttachmentIds });
    expect(tasks.filter(task => task.kind === 'file').map(task => task.postId)).toEqual(['200']);
    expect(tasks.filter(task => task.kind === 'text')).toHaveLength(2);
    expect(validSelection({ ...job.selection, excludedAttachmentIds }).excludedAttachmentIds).toEqual(excludedAttachmentIds);
  });
  it('keeps thumbnail and original identities separate, and never deduplicates generated post text', () => {
    expect(attachmentKey('100:thumbnail:1:' + path, 'thumbnail')).not.toBe(attachmentKey('100:full res:1:' + path, 'full res'));
    const job = makeJob(), tasks = createTasks(job, job.selection);
    const planned = planDuplicates(tasks, true); job.tasks = planned.tasks; job.duplicates = planned.duplicates;
    expect(duplicateReport(job)[0].status).toBe('unavailable');
    Object.assign(job.tasks[0], { status: 'downloaded', bytes: 100 });
    expect(duplicateReport(job)[0]).toMatchObject({ status: 'saved', bytes: 100 });
  });
  it.each([{ deduplicate: 'yes' }, { excludedAttachmentIds: ['100:../../outside'] }, { excludedAttachmentIds: [null] }])('rejects invalid duplicate settings: %j', invalid => {
    expect(() => validSelection({ ...defaultSelection(), ...invalid })).toThrow();
  });
});

describe('exact file comparison', () => {
  it('matches identical bytes despite different names and rejects same-sized translations', async () => {
    const index = new IdenticalFileIndex();
    index.add({ id: 'original', path: 'full res/100_Post/EN.txt', bytes: 2, read: async () => new Blob(['EN']) });
    expect(await index.match(new Blob(['EN']))).toEqual({ id: 'original', path: 'full res/100_Post/EN.txt' });
    expect(await index.match(new Blob(['ZH']))).toBeNull();
    expect(await filesIdentical(new Blob(['a']), new Blob(['ab']))).toBe(false);
  });
  it('compares all bytes even when size and sampled fingerprints match', async () => {
    const left = new Uint8Array(3 * 1024 * 1024), right = left.slice(); right[200000] = 1;
    const index = new IdenticalFileIndex();
    index.add({ id: 'first', path: 'full res/100_Post/file.bin', bytes: left.length, read: async () => new Blob([left]) });
    expect(await index.match(new Blob([right]))).toBeNull();
    expect((await index.match(new Blob([left])))?.id).toBe('first');
  });
  it('does not discard an output when an earlier canonical file has disappeared', async () => {
    const index = new IdenticalFileIndex();
    index.add({ id: 'missing', path: 'full res/100_Post/missing.bin', bytes: 1, read: async () => { throw new DOMException('Missing', 'NotFoundError'); } });
    expect(await index.match(new Blob(['x']))).toBeNull();
  });
});

function referenceHistory() {
  const job = makeJob(), tasks = createTasks(job, job.selection), first = { ...tasks[0], status: 'downloaded', bytes: 12 } as PostTask;
  const archive = { ...tasks[2], status: 'downloaded', bytes: 100, extraction: { state: 'done', files: [{ id: syncKey(tasks[2].id) + ':extract:1', path: tasks[2].path + '.extracted/renamed.bin', bytes: 12, duplicateOf: { id: first.id, path: first.path } }] } } as PostTask;
  const index = emptySync(job); recordSaved(index, first, 'Original'); recordSaved(index, archive, 'Recap'); return index;
}
describe('shared extraction sync history', () => {
  it('round-trips a duplicate reference to retained contents in another post', () => {
    const index = referenceHistory();
    expect(parseSync(index, source).posts).toEqual(index.posts);
  });
  it.each(['missing', 'path', 'size', 'outside'])('rejects a %s duplicate target', kind => {
    const index = referenceHistory(), file = index.posts[1].files[0].extracted![0];
    if (kind === 'missing') file.duplicateOf!.id = 'not-retained';
    if (kind === 'path') file.duplicateOf!.path = 'full res/999_Other/file.bin';
    if (kind === 'size') file.bytes++;
    if (kind === 'outside') file.duplicateOf!.path = '../outside';
    expect(() => parseSync(index, source)).toThrow();
  });
});
