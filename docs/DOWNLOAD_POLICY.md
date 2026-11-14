# Download and retention policy

Post jobs use full-resolution media by default. Optional thumbnail fallback is limited to originals known to be unavailable; network errors and rate limits retry rather than silently substituting another quality. Previews remain in a separate quality folder.

Discord discovery indexes supported media from API records and validated rendered links. It does not invent private attachment IDs. Original/preview attempts follow the selected mode and source policy.

Files are considered saved only after the filesystem writer acknowledges completion. Interrupted jobs retain durable progress and private staged data where supported. ZIP export and direct folder sync share portable history identities.

Exact duplicate handling retains one verified copy and records references in `duplicates.json`. Different bytes, edits and translations remain distinct. Missing shared targets can be recovered.

Automatic and bulk sync retain compressed originals. Manual extraction removes an original only after verifying source and retained-output identities. Failed extraction and conflicting or unverified files are retained.

Cleanup removes extension history/cache according to the selected scope; saved archives stay on disk. Removing a job preserves library connections. Clearing all extension data also removes connections and pending bulk work.

See [filesystem and sync boundaries](AUTO_SYNC.md) for the restrictions applied before writing.
