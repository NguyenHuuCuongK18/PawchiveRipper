export interface ResumeCheckpoint { url: string; etag: string; total: number; bytes: number; files: File[] }
export function strongETag(value: string | null): value is string { return typeof value === 'string' && value.length <= 512 && /^"[^"\x00-\x1f]*"$/.test(value); }
export async function fetchAttachment(url: string, checkpoint: ResumeCheckpoint | undefined, signal: AbortSignal): Promise<{ response: Response; offset: number; total: number | null; etag?: string }> {
  if (checkpoint && (checkpoint.url !== url || !strongETag(checkpoint.etag) || !Number.isSafeInteger(checkpoint.bytes) || !Number.isSafeInteger(checkpoint.total) || checkpoint.bytes <= 0 || checkpoint.bytes >= checkpoint.total)) checkpoint = undefined;
  const request = (resume: boolean) => fetch(url, { credentials: 'omit', redirect: 'error', signal,
    ...(resume && checkpoint ? { headers: { Range: `bytes=${checkpoint.bytes}-`, 'If-Range': checkpoint.etag } } : {}) });
  let response = await request(!!checkpoint), offset = 0;
  if (checkpoint && response.status === 206) {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    if (match && Number(match[1]) === checkpoint.bytes && Number(match[2]) === checkpoint.total - 1 && Number(match[3]) === checkpoint.total && response.headers.get('etag') === checkpoint.etag && !response.headers.get('content-encoding') && (!response.headers.has('content-length') || Number(response.headers.get('content-length')) === checkpoint.total - checkpoint.bytes)) offset = checkpoint.bytes;
    else { await response.body?.cancel(); response = await request(false); }
  } else if (checkpoint && response.status === 416) { await response.body?.cancel(); response = await request(false); }
  if (response.status === 206 && !offset) { await response.body?.cancel(); throw new Error('The server returned an unverified partial attachment.'); }
  const length = Number(response.headers.get('content-length'));
  const total = offset ? checkpoint!.total : Number.isSafeInteger(length) && length > 0 && !response.headers.get('content-encoding') ? length : null;
  const etag = response.headers.get('etag');
  return { response, offset, total, ...(total && strongETag(etag) && !response.headers.get('content-encoding') && (offset || response.headers.get('accept-ranges')?.toLowerCase() === 'bytes') ? { etag } : {}) };
}
