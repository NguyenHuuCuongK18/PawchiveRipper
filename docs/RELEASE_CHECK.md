# Release check: 0.9.1

Local validation completed on 2026-11-09 on Windows with Node.js 26.7.0.

- All 367 unit tests in 32 files passed, together with TypeScript checking, the production build and all seven isolated Chromium suites.
- The browser suites cover general download/folder/restart behavior, native media hosts/fallback, selected-post continuation, tolerant discovery, archive extraction/settings, coexistence with Blocklist and duplicate/shared-file recovery. They now use an original synthetic geometric JPEG rather than captured creator artwork.
- Packaging verification checked all 32 production files against the build, ZIP signatures, matching source/package versions, root/bundled license notices and the published SHA-256 checksum. The installable package includes the MIT license, third-party overview, ZIP library license and decoder/Vite notices.
- Generated browser profiles, screenshots, reports and legacy ZIPs are excluded from Git. Cleanup scripts validate their targets inside the project root. Live recon output no longer overwrites committed fixtures. No personal browser profile or live creator media was used for this release check.
- Source line endings are normalized to LF for consistent packages. GitHub CI separately runs the release gate on Linux/Node 24, with an independently checked-out Blocklist v1.0.0 for coexistence coverage.

Release asset: [pawchive-ripper-0.9.1.zip](https://github.com/NguyenHuuCuongK18/PawchiveRipper/releases/download/v0.9.1/pawchive-ripper-0.9.1.zip), 631,175 bytes.

SHA-256:

```text
3bd8ab2584e329ea9e4e43da4168b5159cf2d7d14e7cea8446965162d521a717
```

The release includes `SHA256SUMS.txt`. Native OS picker dialogs remain a manual smoke check. Install/update instructions are in the README and versioned release notes.

## Previous local validation: 0.9.0

Checked on 2026-11-09 using Windows, Node.js 26.7.0 and isolated Chromium profiles.

- All 367 unit tests in 32 files passed, along with TypeScript checking and the production build. New checks cover repeated content-addressed attachments across posts/partitions, archive exclusions, distinct language variants, bounded file comparison, complete-byte verification after matching fingerprints, missing candidates, duplicate-reference validation, alternate-host recovery and extraction ordering.
- All seven browser suites passed: general regression, native media hosts/fallback, selected-post continuation, discovery tolerance, archive settings/extraction, Blocklist coexistence and the new recap duplicate workflow. Temporary test profiles/downloads were removed. Native OS chooser dialogs remain a manual check.
- The duplicate browser fixture saves an original post and monthly recap with repeated image/ZIP attachments, distinct EN/ZH archive contents and an explicitly excluded ZIP. Only three initial media transfers are made. Five duplicate output/download occurrences share retained copies. Different translations and a nested ZIP remain intact. Exported sync references reconnect to a folder without media transfers; a missing unique output downloads only its source archive. A later single-post job reuses an earlier extracted-only archive without downloading it again. Disabling deduplication preserves independent copies.
- Public metadata for creator `540245` and posts `12837235`, `12624742`, `12428035`, `12505877` shows three recap ZIPs marked `-ZH` and four other source ZIPs with distinct hashes, including `-en-jp` and `-ne` names. These are preserved as potentially different versions, with per-archive UI selection. Similar names are never used as proof of duplicate content. No live creator ZIP or media was downloaded.
- Package, lockfile, source manifest and built manifest identify Pawchive Ripper 0.9.0. Verification checked all 29 production files, ZIP signatures and exact build bytes. Shared extraction references are additive to the existing sync format; storage identifiers remain stable.

Historical local artifact: `pawchive-ripper-0.9.0.zip`, 621,517 bytes (superseded by the public v0.9.1 release).

SHA-256:

```text
750dd51ea2c68f03fef96d46fa8653611cf9f84e7d03ddf15ebe91e80f5ee23b
```

Update the extension directory already loaded by the browser, reload the extension and refresh the site tab. Enable **Avoid exact duplicates** and, for overlapping archive contents, **Extract downloaded archives**. **Archives & versions** can exclude individual bundles before downloading; filenames include their version/language suffixes. Different compressed archives require their first download before their contents can be compared. Existing earlier copies are preserved; new saves/syncs use the chosen duplicate policy. Shared file locations are recorded in `duplicates.json`.

## Previous release: 0.8.0

Checked on 2026-11-09 using Windows, Node.js 26.7.0 and isolated Chromium profiles.

- All 350 unit tests in 31 files passed, along with TypeScript checking and the production build.
- Controlled browser checks cover native media fetching, selected-post ZIP/folder continuation, discovery tolerance, archive extraction/settings, and simultaneous Pawchive Blocklist/Ripper operation. The general browser suite covers downloads, sync, permissions, cleanup and worker restart. Native OS chooser dialogs remain a manual check.
- The new compatibility check loads the real sibling Blocklist extension, blocks every fixture card and still discovers image, MP4 and ZIP attachments. It repairs a cached text-only scan through the visible Refresh scan action, saves synthetic bytes through native fetch into a real ZIP and folder, extracts only the ZIP attachment, skips intact files on another sync, and uses the correct unpartitioned thumbnail after an original returns 404. The purple UI also passes the narrow-width overflow check. Screenshots are under `artifacts/pawchive-ripper-desktop.png` and `artifacts/pawchive-ripper-narrow.png`.
- Public metadata from the first 100 posts of Fanbox creator `32539349` advertised 231 files: 213 images, 9 MP4s and 9 other files. The fixed normalizer recognized all 231, retained their original URLs, generated unpartitioned image thumbnails, and created 331 full-resolution/text tasks. No live creator media was downloaded.
- Package, lockfile, source manifest and built manifest identify Pawchive Ripper 0.8.0. Verification checked all 29 production files, ZIP signatures and exact build bytes. Existing storage/schema identifiers are retained.

Historical local artifact: `pawchive-ripper-0.8.0.zip`, 617,811 bytes (superseded by the public v0.9.1 release).

SHA-256:

```text
8e1a75cd59376ae20b9df5c094d9fe76c73b5c32db0282c4fb38e95827dbd6e5
```

Update the extension directory already loaded by the browser, reload the extension, refresh the Pawchive/Kemono tab, then use **Refresh scan** (or **More options → Scan again**) before downloading. Earlier text-only exports need to be regenerated. Folder destination, post selection and saved sync history survive the scan refresh. Blocks affect the site's rendered cards; Ripper's post selection controls its downloads independently.

## Previous release: 0.7.0

Checked on 2026-10-16 using Windows, Node.js 26.7.0, and controlled Chromium browser scenarios.

- `npm.cmd run release:check` passed: 338 unit tests in 31 files, TypeScript checking, production builds, all five browser suites, ZIP packaging and exact package verification.
- New unit coverage checks all/default/excluded and unknown file types, compound extensions, creator-scoped settings, old settings migration, ZIP/7z/RAR4/RAR5/TAR decoding, encrypted/corrupt archives, unsafe paths and links, original removal ordering, failed-extraction retention, extracted-only sync, missing output recovery and retry after cache cleanup. Generic binary responses for uncommon image formats and explicitly named HTML/JSON attachments are also covered.
- The settings browser suite exercises the real checklist and extraction checkbox, then saves real ZIPs and a folder through bundled extension workers. Successful ZIP, 7z, RAR4/RAR5 and compressed TAR sources are absent from the final output; their contents remain. Corrupt and encrypted sources remain with extraction errors. Settings round-trip on reconnect, intact extracted files skip network requests, extraction retries reuse existing originals, and deleting one output downloads only its compressed source for recovery.
- Existing discovery tolerance, gap retry, media routing, single-post/subset scope, legacy archive continuation, permission recovery, cleanup and service-worker restart browser checks passed. Isolated profiles, saved test folders and downloaded test ZIPs were removed. Native OS chooser dialogs remain a manual smoke check; no live creator media was downloaded for this release check.
- Package, lockfile, source manifest and built manifest identify version 0.7.0. Verification checked all 29 production files, ZIP signatures and exact build bytes, including the extraction worker, bundled WASM decoder and license notices.

Release artifact: `KemonoPawchiveArchiveRipper-0.7.0.zip` (616,958 bytes).

SHA-256:

```text
6f0b983149fbbde0f3b733c6c72d1c9d699d42e666b5dc14458ce95dea9a823d
```

Update the directory already loaded by the browser, reload the extension and refresh the archive tab. File types default to all selected; extraction defaults off. Existing folders without `settings.json` get default type/extraction settings and receive the file on their next sync. ZIP extraction streams; other decoder inputs are limited to 512 MiB. Each archive has limits of 10,000 regular files and 8 GiB of output; unsupported or failed extraction preserves the compressed source and reports the error.

## Previous release: 0.6.1

Checked on 2026-10-15 using Windows, Node.js 26.7.0, and controlled Chromium browser scenarios.

- All 297 unit tests in 28 files passed. Transfer tests simulate an actively streaming file lasting six minutes, a stream that stops sending data, pause during connection, late image decoding, and encoded content lengths. The former native timeout is tied to the simulated clock so the long-transfer regression detects an overall five-minute deadline.
- TypeScript checking and production builds passed. All four controlled browser scripts passed. The general browser check verifies that active filenames and received bytes appear while zero files have completed, and that Pause remains responsive.
- Queue tests cover prioritizing text/images, publishing partial bytes without counting a completed file, concurrent starts/completions, and retained rate-limit deadlines. Completion results are persisted before their offscreen records are released.
- Public metadata reproduced the reported Fanbox creator's 788 tasks exactly. Header-only checks found roughly 230–246 MB ZIP/PSD attachments near the reported count and at least 6.18 GiB in 60 source files with readable sizes. Small range samples read bounded data without saving creator content. These checks establish file availability/scale, not the exact active task or throughput in the user's browser.
- Package, lockfile, source manifest, and built manifest identify version 0.6.1. Package verification checked all 18 production files, exact build bytes, and ZIP signatures. Browser test profiles and archives were removed by the scripts.

Release artifact: `KemonoPawchiveArchiveRipper-0.6.1.zip` (177,656 bytes).

SHA-256:

```text
2e4fdd8d6ab58b128c16456de180833d3a6b53707c18d9f1fc64f42e741b0b66
```

Update the directory already loaded by the browser, reload the extension, and refresh the archive tab. Existing collected files remain reusable; resume if the job is paused. Active downloads can exceed five minutes while data arrives. A 90-second absence of data triggers the existing bounded retry policy. Native chooser dialogs remain a manual smoke check.

## Previous release: 0.6.0

Checked on 2026-10-15 using Windows, Node.js 26.7.0, and controlled Chromium browser scenarios.

- All 290 unit tests in 27 files passed, including automatic/manual discovery skips, partial page validation, retry of persisted gaps, retained expected totals, repeated outage guards, missing attachments and report-only exports. TypeScript checking and the production build passed.
- All four browser scripts passed: the general regression suite, native media acceptance, selected-post archive continuation, and the new tolerance acceptance check.
- Tolerance acceptance combined a missing post detail, a foreign creator record, a page returning HTTP 503 through its retry budget, and a missing attachment. Available text was saved to a real ZIP and folder, with all four errors recorded in each failures.json. Retry recovered the discovery gaps and added posts without losing saved folder files; the report retained only the missing attachment. The overlay's Skip this error action continued a paused repeated page.
- Package, lockfile, source manifest, and built manifest all identify version 0.6.0. Package verification checked the 18 production files, exact build bytes, and ZIP signatures. Browser profiles and test archives were removed by the test scripts. No live media or creator content was downloaded for these controlled checks.

Release artifact: `KemonoPawchiveArchiveRipper-0.6.0.zip` (176,707 bytes).

SHA-256:

```text
48c07786a1e3159a60d9aff0e45ac20d5b9fc020a9fb592e4690155fb4d144d2
```

Update the existing extension directory, reload the extension, and refresh the archive tab. Resume a previously paused scan, or choose Skip this error to continue past its current discovery failure. Tolerance is automatic for isolated failures; access errors, rate limits and three consecutive bad pages still pause. Native operating-system chooser dialogs remain a manual check.

## Previous release: 0.5.2

Checked on 2026-10-15 using Windows, Node.js 26.7.0, and controlled Chromium browser scenarios.

- All 274 unit tests in 26 files passed. New coverage checks invalid JSON and interrupted response bodies, alternate post-list routes, unchanged rate-limit handling, and recovery of a saved scan at 1150/3349 with bounded retries and retained posts/cursor.
- TypeScript checking and the production build passed. The controlled browser scan recovered when both list endpoints initially returned truncated JSON; media acceptance and selected-post archive continuation also passed.
- The patched client validated all 2,199 remaining public posts from offset 1150 for Patreon creator `19875180`, ending on the empty page at offset 3350. This matches the reported total of 3,349 with the earlier 1,150 posts. No media was downloaded for this live check.
- Package, lockfile, source manifest, and built manifest all identify version 0.5.2. Package verification checked the 18 production files, exact build bytes, and ZIP signatures.

Release artifact: `KemonoPawchiveArchiveRipper-0.5.2.zip` (175,429 bytes).

SHA-256:

```text
46d1ae739b00d414cc08bf0b048bf04bdf3d499f4885813f46c5ad4e56567015
```

Update the existing extension directory, reload the extension, refresh the Pawchive tab, and choose **Resume** or **Retry failures** on the paused job to retain its first 1,150 posts and current page. Unreadable responses retry automatically; repeated failures pause at the same cursor. Native operating-system chooser dialogs remain a manual check.

## Previous release: 0.5.1

Checked on 2026-10-15 using Windows, Node.js 26.7.0, and controlled Chromium browser scenarios.

- All 256 unit tests in 25 files passed, including recovery of a saved scan at offset 450 through both Resume and Retry, prefixed detail IDs, direct post links, and native/legacy sync history.
- TypeScript checking and the production build passed. The browser regression, native media acceptance, and selected-post archive continuation scripts passed. The browser fixture includes `p-1237087` and verifies that it survives ZIP export and subsequent folder sync.
- The patched client validated all 50 posts from the live Patreon creator `19875180` at offset 450 and fetched post `p-1237087` with its matching creator and service. No media was downloaded for this live check; the full live creator was not rescanned.
- Package, lockfile, source manifest, and built manifest all identify version 0.5.1. Package verification checked the 18 build files, their exact bytes, and ZIP signatures. Temporary browser profiles and downloaded test content were removed by the test scripts.

Release artifact: `KemonoPawchiveArchiveRipper-0.5.1.zip` (175,352 bytes).

SHA-256:

```text
597a385e3250271b08dad4b83ea5b4bc1e2949a9c9a0cffb32f26fdb1e1af637
```

Update the directory already loaded by the browser, reload the extension, refresh the Pawchive tab, and choose **Resume** or **Retry failures** on the existing paused job. Its earlier posts and scan cursor are retained. Native operating-system chooser dialogs remain a manual smoke check; automated folder tests use real OPFS handles with picker dialogs replaced for headless execution.

## Previous release: 0.5.0

Checked on 2026-10-11 using Windows, Node.js 26.7.0, and controlled Chromium browser scenarios.

- `npm.cmd run release:check` passed: 222 unit tests in 23 files, TypeScript checking, production build, browser regression scenarios, native media acceptance, selected-post archive continuation, packaging, and package verification.
- The selected-post browser check saved one selected post as a ZIP, extracted it, connected its `sync.json`, and added only another selected post. Repeating the save transferred no duplicate media. Connecting the same archive from a separate post page preserved that single-post scope and cumulative history.
- Native media acceptance covered 22 controlled Kemono/Pawchive hosts. These are fixture-based checks rather than a live throughput benchmark.
- `npm.cmd audit --json` reported zero vulnerabilities after upgrading Vitest to 5.0.3.
- Package, lockfile, source manifest, and built manifest all identify version 0.5.0. The release ZIP contains exactly the 18 production build files, with matching bytes and valid ZIP CRC checks.
- Removed 16 obsolete release ZIPs and temporary probe/test output. Rebuilt `dist`; temporary browser profiles and extracted acceptance archives were removed after testing.

Release artifact: `KemonoPawchiveArchiveRipper-0.5.0.zip` (175,209 bytes).

SHA-256:

```text
729398aeeb0bd21c7e67b7b1b759f9214ffcb005816813b841f78d71668240cc
```

Native operating-system file/folder dialogs and permission prompts remain a manual smoke check. Automated folder tests use real OPFS handles with picker dialogs replaced for headless execution. Reload the extension, save a small selected ZIP, extract it, connect its `sync.json` through the native chooser, and save one additional post before distributing it as a public release.
