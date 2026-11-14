# Pawchive Ripper

Save Patreon/Fanbox posts and Discord archives from **Pawchive** and **Kemono** to your device. The extension opens on the current page and supports creator folders, incremental sync, ZIP exports, archive extraction and exact duplicate handling.

[Download the latest release](https://github.com/NguyenHuuCuongK18/PawchiveRipper/releases/latest) · [Release notes](CHANGELOG.md) · [Report an issue](https://github.com/NguyenHuuCuongK18/PawchiveRipper/issues)

## Install

Requires a Chromium browser supporting Manifest V3 (Chrome/Edge 120+; compatible Brave versions). Creator-folder saving also requires the File System Access API.

1. Download **pawchive-ripper-1.1.0.zip** from the [release assets](https://github.com/NguyenHuuCuongK18/PawchiveRipper/releases/tag/v1.1.0) and extract it into a permanent folder.
2. Open **chrome://extensions** (or **edge://extensions** / **brave://extensions**) and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing **manifest.json**.
4. Refresh an open **pawchive.pw** or **kemono.cr** tab. Click the extension icon to open the overlay.

Download the named extension ZIP, rather than GitHub's automatically generated **Source code** archives. Those contain source files and require a build. This is an unpacked extension release, not a signed Web Store package.

**Updating:** replace the files inside the folder already loaded by your browser, click **Reload** on the extensions page, then refresh the site tab. Keep that folder path to retain the extension identity and its local jobs. If you develop from source, load **dist/** after building. An older cached scan can be refreshed with **Refresh scan** or **More options → Scan again**.

## Save posts

1. Open a creator profile or an individual Patreon/Fanbox post on either supported site.
2. Open the extension. Discovery starts for that page's scope. A post page defaults to **This post only**; use the scope selector to scan its creator instead.
3. Wait for discovery. Expand **Posts** to choose a subset, or leave **All posts** selected.
4. Choose **Images**, **Other files**, and/or **Post text**. **File types** selects individual advertised extensions. **Archives & versions** lets you search and exclude individual ZIPs or other bundles before downloading.
5. Choose **Creator folder** or **ZIP file**, then save.

Posts use full resolution by default. **Save thumbnail if unavailable** only substitutes a preview for an original marked missing or returning HTTP 404/410. Previews go in **thumbnail/** and remain separate from originals. Network errors and rate limits use bounded retries.

For a creator folder, **Choose save location** opens a separate access tab. Allow the folder, return to the creator, and choose **Save to folder**. Keep the access tab open until saving finishes. The extension creates a wrapper such as:

~~~text
fanbox_CreatorId_CreatorName/
  full res/
    2026-11-01_PostId_PostTitle/
      001_image.jpg
      002_clip.mp4
      post.txt
  thumbnail/
  sync.json
  settings.json
  failures.json
  duplicates.json
~~~

Post dates use UTC. Invalid/missing dates use **unknown-date**. Generated text contains the source URL and selected post content; external embeds are recorded rather than downloaded.

## Update an existing archive

Open **Creators & sync**, then **Connect archive folders**. Choose your archive root on the read-only import page. Only folders named `fanbox_ID_Name` or `patreon_ID_Name` with valid `sync.json` or supported legacy `manifest.json` are connected. Import does not change archive files or grant write access.

Select creators individually or use **Select all** / **Clear selection**.

- **Allow first-sync folders:** approve selected creators awaiting their first sync. Each saved folder is preloaded; click **Allow folder** and confirm. Already-authorized folders are skipped. This grants access without starting downloads.
- **Check selected:** check recent posts once, without downloads.
- **Sync selected:** check the full archive and save missing or changed files. This also repairs missing files when recent posts have not changed.
- **Stop:** clear the batch queue and pause its active save. Saved files stay.
- **Auto sync:** choose **Off**, **Check only**, or **Auto sync** for scheduled checks. Bulk buttons work independently of this setting.

Automatic checks run at most every 30 minutes per creator while Pawchive/Kemono is open. Full automatic scans run initially, after recent changes, and weekly. Batches process one creator at a time, wait behind current work, and retain their queue after a worker restart. Permission failures are skipped so other selected creators can continue. Existing duplicate preferences and single-post/subset scopes are preserved; bulk and automatic sync keep compressed originals.

**First sync needed** means no saved comparison yet; it does not confirm updates. **No recent changes** describes recent posts only. **Needs permission** means use **Allow access** before saving. Expand **Details** for folder names, timestamps and errors.

Connections survive job and cache cleanup. Browser permission can expire, but **Allow access** reuses the stored creator folder. Keep the access tab open while saving. **Clear all extension data** removes connections and pending batches; saved archives remain on disk. See [sync behavior and safety](docs/AUTO_SYNC.md) for implementation details.

All direct folder writes require both the creator naming scheme and matching validated archive identity metadata. Existing directories without proper metadata are refused; only a newly created empty creator directory can be initialized. Writes are limited to managed quality/post/extraction paths and known metadata filenames. Conflicting extraction outputs are retained alongside the new version. Removing an extracted compressed source requires cryptographic identities for the source and every retained output; older histories without that evidence retain their compressed source. Legacy Discord parent-folder writes are disabled; use ZIP export.

These are application and browser-handle restrictions. Windows reparse-point/junction behavior is not an independently enforced OS sandbox; strict OS-level no-follow enforcement would require a native helper. Automated browser safety checks use disposable browser-private fixture folders, never the user's archive.

1. Extract an earlier ZIP if necessary.
2. Open that creator or the next post you want to save.
3. Choose **Creator folder → Choose sync.json** and select the history inside the existing creator folder. Allow that folder when requested. **Change folder** can connect the folder directly.
4. Save your selected posts or choose **Sync folder** for an entire creator.

Sync checks recorded paths and sizes, skips intact files, and recovers missing outputs. Importing history retains the current single-post/subset scope. Earlier successful history and unrelated files stay in place. An older post **manifest.json** is also accepted.

| File | Purpose |
| --- | --- |
| sync.json | Successful file history and shared-output references used by folder sync |
| settings.json | Creator-scoped content, file-type, archive and duplicate preferences |
| failures.json | Missing media, extraction errors and discovery gaps; retry from the overlay |
| duplicates.json | Repeated source paths and the retained file locations |
| manifest.json | ZIP export metadata; new ZIPs include this alongside the portable sync history |

## Handle monthly recaps and duplicates

**Avoid exact duplicates** defaults on for new jobs. Repeated attachment hashes download once per quality across selected posts. Text remains available for each post. Folder sync can reuse an identical attachment saved by an earlier post, including complete extracted-only archives.

Enable **Extract downloaded archives** as well to compare files inside different bundles with loose media and earlier extracted contents. Only byte-identical files share a retained copy. Names, sizes, language suffixes and sampled fingerprints alone are insufficient. Different translations, edits and resolutions stay separate.

Different compressed archives still need their first download before their contents can be compared. To avoid an unwanted version's transfer entirely, uncheck it in **Archives & versions**. Earlier duplicate copies already on disk are preserved; the option governs new saves and syncs. Shared locations are recorded in the JSON files.

Extraction supports ZIP, 7z, RAR4/RAR5, TAR and gzip/bzip2/xz-compressed TAR. Successful extraction retains the contents and removes the compressed source only after saving recovery metadata and verifying retained outputs. Failed/encrypted/unsupported archives are kept and reported. Nested archives remain files rather than being recursively unpacked.

Limits: 10,000 regular files and 8 GiB expanded output per archive. Non-ZIP decoders accept at most 512 MiB compressed input. Unsafe paths, links and duplicate sanitized paths are rejected.

## Discord

Open a supported **/discord/server/ServerId** or **/discord/server/ServerId/ChannelId** page. The overlay selects the server/channel; a channel page can switch to the entire server. Discord defaults to thumbnails and a ZIP. Originals need an observed original URL; **Best available** can use surviving previews. Discord retains its separate archive layout.

## Progress, storage and troubleshooting

- **Pause / Resume** preserves completed transfers. **Retry failures** retries failed media, extraction and discovery gaps. Isolated missing records do not prevent saving available content.
- **Restore folder access** reopens the access tab when the browser needs permission again. Allow the existing folder, then return to the creator.
- A large transfer can keep the completed-file count unchanged; inspect its filename and received bytes. Transfers time out after 90 seconds without incoming data, rather than a fixed overall download duration.
- Use **Scan again** for stale media URLs. Site access failures, rate limits or repeated bad API pages can pause discovery; check the site tab before retrying.
- **Storage & history** lists temporary caches and jobs. Automatic cache cleanup defaults to five idle minutes; active jobs and paused downloads are protected. Removing a cache/job or clearing local extension data asks for confirmation and leaves downloaded ZIPs and chosen archive folders on disk.

Jobs, scan history and folder handles stay in extension-owned IndexedDB; temporary files use private browser storage. Large file transfers can resume from closed 8 MiB private chunks when the server supplies a strong ETag and byte-range support. Changed validators, invalid ranges and unsupported servers restart safely. Assembling resumed files temporarily needs space for the chunks plus the completed staged file. ZIP exports also need space for their output ZIP. There is no telemetry, account synchronization or server component. Extension requests omit cookies.

[Pawchive Blocklist](https://github.com/NguyenHuuCuongK18/Pawchive-blocklist) can run alongside Ripper. Its hidden cards do not define the download scope: Ripper reads the API independently. Use Ripper's own post/archive selection.

## Build and contribute

Node.js 24 LTS is recommended; the supported ranges are in **package.json**.

~~~sh
npm ci
npx playwright install chromium
npm run check
npm run release:check
~~~

Load **dist/** after building. The complete release check includes eight isolated browser suites, packaging and byte-for-byte ZIP verification. The coexistence suite needs a sibling Blocklist checkout; setup and individual commands are in [development notes](docs/DEVELOPMENT.md).

**npm run package** produces the extension ZIP plus **releases/SHA256SUMS.txt**. **npm run release:verify** checks their contents, versions, checksums and bundled notices. **npm run clean** removes generated test output, browser profiles, old local packages and release output; it preserves source, dependencies and the built extension.

See [architecture](docs/ARCHITECTURE.md), [download policy](docs/DOWNLOAD_POLICY.md), [release validation](docs/RELEASE_CHECK.md) and [fixture provenance](tests/fixtures/README.md).

## License

Original code and generated assets are [MIT licensed](LICENSE). Bundled dependencies retain the licenses listed in [third-party notices](THIRD_PARTY_NOTICES.md); their notices are included in the extension ZIP. This software license does not license downloaded creator content.
