import { describe, it, expect } from 'vitest';
import messages from './fixtures/channel-2222222222222222222-0.synthetic.json';
import first from './fixtures/channel-3333333333333333333-0.synthetic.json';
import second from './fixtures/channel-3333333333333333333-150.synthetic.json';
import { normalizeMessages, normalizeTimestamp } from '../src/core/mediaNormalizer';
import { mergeMedia } from '../src/core/deduplicator';
import { candidates, detectImage } from '../src/core/mediaResolver';
import { safeSegment, buildFilename } from '../src/core/filenameBuilder';
import { advancePage } from '../src/core/pagination';
import { csv, manifest } from '../src/storage/manifestExporter';
import { checkpoint, scope, job } from './helpers';
describe('synthetic channel fixture', () => {
  it('indexes all 57 attachments from 32 generated messages without fabricating originals', () => {
    const records = normalizeMessages(messages, scope, 'test-job');
    expect(messages).toHaveLength(32); expect(records).toHaveLength(57);
    const bird = records.find(record => record.originalFilename === 'bird_01.png')!;
    expect(bird.messageId).toBe(scope.channelId);
    expect(bird.thumbnailUrl).toBe('https://img.kemono.cr/thumbnail/data/aa/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png');
    expect(bird.attachmentId).toBeNull(); expect(bird.discordCdnUrl).toBeNull(); expect(bird.originalUrl).toBeNull();
    expect(bird.publishedRaw).toBe('2026-01-01T12:34:56.123456'); expect(bird.publishedAtUtc).toBe('2026-01-01T12:34:56.123Z');
    expect(mergeMedia(records, records)).toHaveLength(57);
  });
  it('preserves distinct attachment ordinals even when names and paths repeat', () => {
    const record = messages[0]; const attachment = record.attachments[0];
    const records = normalizeMessages([{ ...record, attachments: [attachment, attachment] }], scope, 'test-job');
    expect(mergeMedia([], records)).toHaveLength(2);
    expect(buildFilename(records[0], 'png')).not.toBe(buildFilename(records[1], 'png'));
  });
  it('retains byte validation separately from the original hash', () => {
    const record = normalizeMessages(messages, scope, 'test-job')[0];
    record.bytes = 55959; record.sha256 = '00000000000000000000000000000000000000000000000000000000000001db';
    expect(record.sha256).not.toBe(record.kemonoFileHash);
    expect(JSON.parse(manifest(job(), [record])).media[0].bytes).toBe(55959);
  });
  it('extracts only explicitly present Discord image links', () => {
    const records = normalizeMessages([{ id: '123', content: 'https://cdn.discordapp.com/attachments/123/456/bird.png?ex=123 https://cdn.discordapp.com/avatars/123/a.png' }], scope, 'test-job');
    expect(records).toHaveLength(1); expect(records[0].discordCdnUrl).toContain('/attachments/123/456/bird.png');
    expect(records[0].attachmentId).toBeNull(); expect(records[0].publishedAtUtc).toBeNull();
  });
});
describe('generated multi-page pagination', () => {
  it('processes both pages and requires a validated empty page to finish', () => {
    let cp = checkpoint('3333333333333333333');
    cp = advancePage(cp, first); expect(cp.offset).toBe(150); expect(cp.coverage).toBe('scanning');
    cp = advancePage(cp, second); expect(cp.offset).toBe(300); expect(cp.coverage).toBe('scanning');
    cp = advancePage(cp, []); expect(cp.messageIds).toHaveLength(209); expect(cp.coverage).toBe('complete'); expect(cp.terminal).toBe('empty-page');
  });
  it('stops repeated pages with an error instead of claiming completeness', () => {
    const cp = advancePage(checkpoint(), messages);
    expect(() => advancePage(cp, messages)).toThrow('repeated'); expect(cp.coverage).toBe('scanning');
  });
});
describe('files and source policy', () => {
  it('interprets naive dates as UTC and rejects invalid dates', () => {
    expect(normalizeTimestamp('2024-08-02T18:17:01.880123')).toBe('2024-08-02T18:17:01.880Z');
    expect(normalizeTimestamp('2024-08-02T18:17:01+07:00')).toBe('2024-08-02T11:17:01.000Z');
    expect(normalizeTimestamp('2024-02-30T18:17:01')).toBeNull(); expect(normalizeTimestamp('garbage')).toBeNull();
  });
  it('uses safe folders and deterministic publication-based filenames', () => {
    expect(safeSegment('CON')).toBe('_CON'); expect(safeSegment('../evil\\name')).not.toMatch(/[\\/]/);
    const record = normalizeMessages(messages, scope, 'test-job')[0];
    expect(buildFilename(record, 'png')).toContain('/2026-01-01_123456Z_2222222222222222222_001_');
    record.publishedAtUtc = null; expect(buildFilename(record, 'jpg')).toContain('unknown-date');
  });
  it('replaces Unicode characters Chromium rejects while preserving Japanese text and emoji', () => {
    expect(safeSegment('こゃめた')).toBe('こゃめた');
    expect(safeSegment('🐈\u200d⬛👓')).toBe('🐈_⬛👓');
    for (const character of ['\u0085', '\u200b', '\u200e', '\u2060', '\ufeff', '\ufdd0', '\uffff', '\u{1ffff}', '\ud800']) {
      expect(safeSegment(`before${character}after`)).toBe('before_after');
    }
    expect(safeSegment('~ title\u3000~')).toBe('title');
  });
  it('does not leave half an emoji when truncating a long folder name', () => {
    expect(safeSegment('a'.repeat(39) + '🐈')).toBe('a'.repeat(39));
    expect(safeSegment('a'.repeat(38) + '🐈')).toBe('a'.repeat(38) + '🐈');
    expect(safeSegment('a'.repeat(39) + '.extra')).toBe('a'.repeat(39));
  });
  it('keeps original attempts opt-in, and never substitutes previews in original mode', () => {
    const record = normalizeMessages(messages, scope, 'test-job')[0];
    record.originalUrl = `https://n3.kemono.cr/data${record.kemonoPath}`;
    expect(candidates(record, { mode: 'best', tryOriginal: false })[0].quality).toBe('thumbnail');
    expect(candidates(record, { mode: 'best', tryOriginal: true }).map(c => c.quality)).toEqual(['original', 'thumbnail']);
    expect(candidates(record, { mode: 'original', tryOriginal: false })).toHaveLength(1);
  });
  it('recognizes actual formats and rejects HTML even with an image MIME', () => {
    expect(detectImage(new TextEncoder().encode('<html>Error page</html>'))).toBeNull();
    expect(detectImage(Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]))?.ext).toBe('png');
    expect(detectImage(Uint8Array.from([255,216,255,224,0,0,0,0,0,0,0,0]))?.ext).toBe('jpg');
  });
  it('exports all metadata without fetching bytes and protects CSV cells', () => {
    const record = normalizeMessages(messages, scope, 'test-job')[0]; record.originalFilename = '=HYPERLINK("bad")';
    expect(csv([record])).toContain("'=HYPERLINK");
    expect(JSON.parse(manifest(job(), [record])).media[0].status).toBe('discovered');
    expect(JSON.parse(manifest(job(), [record])).media[0]).not.toHaveProperty('blobUrl');
  });
});
