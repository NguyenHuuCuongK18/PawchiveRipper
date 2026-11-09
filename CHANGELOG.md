# Changelog

## 0.9.1 — 2026-11-09

- Prepare the renamed Pawchive Ripper repository for public distribution with a focused usage README, development guide and versioned release notes.
- Add the MIT license and complete runtime dependency notices to the repository and installable ZIP. Verify notice copies, package bytes and published SHA-256 checksums.
- Replace the captured browser-test artwork with an original generated geometric JPEG; document fixture provenance and keep live recon captures out of committed fixtures.
- Keep generated packages, browser profiles, screenshots and editor state out of source control. Add bounded cleanup tooling, LF source normalization, CI and a manual tagged-release workflow.

## 0.9.0 — 2026-11-09

- Add **Avoid exact duplicates**, enabled for new jobs. Repeated attachment hashes share one transfer per quality, including source archives reposted under different names or storage partitions. Preserve each post's text and keep alternate download hosts for missing originals.
- Add a searchable **Archives & versions** checklist with per-archive selection and select/clear controls. Persist choices and duplicate settings in creator-scoped settings. Different language variants and edits are retained automatically.
- Compare extracted files against loose media, earlier archives and existing creator-folder history. Use bounded fingerprints for candidate lookup and complete byte comparisons before sharing outputs. ZIPs/folders contain one retained copy plus `duplicates.json` references; sync history validates shared targets and recovers missing outputs.
- Reuse identical earlier archives during subset/single-post folder sync, including complete extracted-only archives. Keep legacy sync/settings compatible and allow duplicate handling to be disabled for independent copies. Previously saved files are preserved.
- Add duplicate-planning, exact-comparison, settings/reference-validation, alternate-host and extraction-order unit checks, plus a complete recap ZIP/folder browser workflow with translation preservation and missing-output recovery.

## 0.8.0 — 2026-11-09

- Rename the extension to **Pawchive Ripper** and match Pawchive Blocklist's purple colors, typography, controls and branded header. Align release names as `releases/pawchive-ripper-VERSION.zip`, and show the installed version in the overlay.
- Accept Pawchive's partitioned three-character storage shards for originals, including images, MP4 and source archives. Generate unpartitioned thumbnail paths, merge inline previews with their originals, and accept partitioned identities when reading saved sync history.
- Mark old scans with a visible **Refresh scan** action so cached text-only results can be repaired while retaining destination, selection and sync history. Keep existing extension storage and portable formats compatible.
- Use indexed post/media lookups during discovery and ZIP generation, select bounded transfer batches without sorting the full queue, reuse directory handles during folder verification, and disconnect Discord DOM observation on post/profile pages.
- Add unit regressions and a two-extension Chromium check covering hidden creator cards, old scan recovery, native image/MP4 transfer, optional ZIP extraction, actual folder writes, unchanged sync, thumbnail fallback and narrow UI layout.

## 0.7.1 — 2026-10-18

- Replace Unicode control/format characters such as emoji zero-width joiners in generated folder and file names, and keep emoji intact when shortening names. Trim whitespace and tildes that Chromium disallows at the ends of names.
- Continue folder sync when an older ZIP contains a saved path rejected by the browser with “Name is not allowed.” Download the affected file at its newly sanitized path, update its history after saving, and keep other successful files reusable. Permission and unrelated filesystem errors still surface.
- Preserve extracted-output history when matching sync entries are merged, reuse identical extracted outputs, and replace changed contents at stable paths so retries do not accumulate suffixed duplicate files.
- Add regression coverage for Unicode names, truncated emoji, rejected legacy directories/files, successful recovery, and permission errors.

## 0.7.0 — 2026-10-16

- List detected file extensions after scanning, including custom extensions, compound TAR formats and unknown files. Select or deselect each type; all are selected initially and new types stay selected during sync.
- Add optional ZIP, 7z, RAR4/RAR5 and compressed TAR extraction in a dedicated worker. Keep only extracted contents after success; retain compressed files and report errors after failed, encrypted or unsupported extraction. Retry extraction without downloading an existing source again.
- Save content/type/extraction choices in `settings.json` in ZIPs and creator folders. Restore them on folder connection. Older archives default to all file types with extraction off and receive settings on their next sync.
- Record extracted outputs in sync history. Verify their existence/size before skipping transfers, recover missing outputs, and persist recovery metadata before removing a successfully extracted compressed source.
- Preserve uncommon image originals served as binary and explicitly named HTML/JSON attachments. Include bundled decoder assets and license notices in the release.
- Add tests for settings migration, filtering, safe decoding, original retention/removal, and extracted-only sync, plus a controlled browser extraction and settings check.

## 0.6.1 — 2026-10-15

- Replace the five-minute overall media timeout with a 90-second inactivity deadline so healthy large ZIP/PSD downloads can finish. Bound image validation separately and close late bitmap results after cancellation.
- Show current filenames, received bytes, advertised sizes, validation and retry waits while completed-file counts remain unchanged.
- Prioritize text/images before source archives fill the pool. Batch transfer status reads, durable completion writes and queue starts to reduce database/message overhead, preserving results before releasing them.
- Reproduce the reported Fanbox creator's exact 788-task workload (460 images, 166 files, 162 texts). Nearby ZIP/PSD files are approximately 230–246 MB and currently return HTTP 200; the saved-file count alone cannot establish a frozen queue.
- Add healthy transfers longer than five minutes, stalled streams, cancellation, late image decoding, byte progress and scheduling regression tests, plus browser coverage for visible partial-transfer progress.

## 0.6.0 — 2026-10-15

- Continue discovery past missing post details and isolated pages that fail after retries. Keep useful list metadata and good records on partly invalid pages; never include records from a different creator/service.
- Persist skipped post/page errors with source, reason, status, attempts and time. Include discovery errors alongside media errors in ZIP and folder `failures.json`; show the error count in the overlay and retain expected totals when gaps remain.
- Add **Skip this error** for paused discovery and let **Retry failures** revisit completed scan gaps without restarting pagination. Existing saved folder files and successful sync history remain reusable; recovered posts can then be saved automatically.
- Keep access failures and rate limits paused, and stop automatic skipping after three consecutive bad pages. Support report-only exports when a missing single post has no available content.
- Add scan-tolerance unit coverage and a browser acceptance check for mixed failures, ZIP/folder reports, recovered gaps and manual skip.

## 0.5.2 — 2026-10-15

- Retry malformed successful API responses and interrupted response bodies with the existing bounded backoff instead of immediately pausing discovery. Keep the scan cursor and earlier posts until a complete response validates.
- Try the alternate post-list endpoint at the same offset when JSON is unreadable or a request is interrupted. HTTP rate limits and structured validation errors retain their normal handling.
- Add regression coverage for recovery at 1150/3349 posts, repeated failures, cooldowns, retained progress, manual retry, and browser recovery when both list endpoints initially return truncated JSON.

## 0.5.1 — 2026-10-15

- Accept Pawchive post IDs with the `p-` prefix in creator scans, single-post links, detail requests, and native/legacy sync history. Creator and service matching still apply.
- Fix the reported Patreon creator scan stopping at offset 450 on `p-1237087`. Existing paused jobs can Resume or Retry failures from their saved page without losing earlier posts.
- Report invalid post IDs separately from creator/service mismatches. Add scan recovery tests and browser coverage for prefixed IDs in ZIPs and folder sync.

## 0.5.0 — 2026-10-11

- Select individual posts on creator profiles with checkboxes, Clear selection, and All posts. Selections persist across progress refreshes and job reloads.
- Keep the current single-post scope or selected creator subset when connecting a creator folder, choosing sync.json, or importing history. Previously sync-file connection and history import silently expanded single-post jobs to the entire creator.
- Extend an extracted ZIP with only newly selected posts while retaining earlier files and cumulative sync history. Repeat saves verify existing files and avoid duplicate media downloads. Whole-creator rescans remain available through All posts and Sync folder.
- Include only chosen posts in ZIP media and manifest metadata. Shared sync history keeps its creator-wide identity; it does not carry a job's post filter into other jobs.
- Add permanent scope regression tests, a controlled browser check for ZIP extraction and selective folder continuation, and a release gate that verifies packaged bytes and version agreement.
- Upgrade Vitest to 5.0.3 to resolve the dependency audit findings. Development requires a compatible Node 22.12+, 24, or 26+ release.
- Remove obsolete release ZIPs and temporary probe/test output. Keep the current production build and release ZIP.

## 0.4.3

- Add device-aware media concurrency with gradual growth, rate-limit and transient-failure backoff, persisted cooldowns, and a current-limit indicator.

## 0.4.2

- Connect an existing creator archive by choosing sync.json or a legacy manifest.json, with direct-folder identity checks and permission recovery.
