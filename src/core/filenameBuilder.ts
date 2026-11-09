import type { MediaRecord, Job } from './types';
import { stableToken } from './mediaNormalizer';
export function safeSegment(value: string | null, fallback = 'unnamed'): string {
  // Chromium also rejects Unicode controls/formatting, including emoji joiners.
  let safe = (value || fallback).normalize('NFKC').replace(/[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}\p{Noncharacter_Code_Point}]/gu, '_').replace(/^[.\s~]+|[.\s~]+$/gu, '').slice(0, 40);
  // Keep the existing UTF-16 length limit without splitting an emoji in half.
  safe = safe.replace(/[\ud800-\udbff]$/u, '').trim().replace(/[.\s~]+$/gu, '');
  if (!safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = '_' + (safe || fallback);
  return safe;
}
export function serverFolder(job: Pick<Job, 'serverId' | 'serverName' | 'service'>): string { return `ArchiveRoot/${job.service === 'discord' ? 'discord/' : ''}${job.serverId}_${safeSegment(job.serverName, 'server')}`; }
export function channelFolder(record: Pick<MediaRecord, 'serverId' | 'serverName' | 'channelId' | 'channelName' | 'service'>): string { return `${serverFolder(record)}/${record.channelId}_${safeSegment(record.channelName, 'channel')}`; }
export function buildFilename(record: MediaRecord, ext: string): string {
  if (!/^(png|jpg|webp|gif|avif)$/.test(ext)) throw new Error('Unvalidated image format');
  const stamp = record.publishedAtUtc ? record.publishedAtUtc.slice(0, 19).replace('T', '_').replace(/:(\d{2})/g, '$1') + 'Z' : 'unknown-date';
  return `${channelFolder(record)}/${stamp}_${record.messageId || 'unknown-message'}_${String(record.attachmentIndex).padStart(3, '0')}_${stableToken(record.id).slice(0, 8)}.${ext}`;
}
