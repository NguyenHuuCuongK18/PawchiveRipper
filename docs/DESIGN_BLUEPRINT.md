# Architecture

Pawchive Ripper is a Manifest V3 extension with a site overlay, a serial background coordinator and an offscreen filesystem/media worker.

## State and scheduling

- IndexedDB stores jobs, compact progress summaries, creator connections, settings and the persistent bulk queue.
- Creator handles belong to the library rather than a temporary job. Removing a job does not remove its creator connection.
- Opening a supported site wakes due automatic checks. Bulk actions are explicit one-time work and can run with automatic mode off.
- Active manual work and ZIP saves take priority. Rate-limit deadlines are shared per source origin.

## Archive boundary

Root discovery is read-only and registers eligible child handles only. Writes require matching creator naming, validated history identity and a managed relative path. The root handle is never a writing destination. Missing or malformed metadata fails closed; initialization of a new empty folder is a separate path.

Folder permission requests run from a top-level extension page and a direct user click. First-sync approval advances through selected saved child handles without a picker. Permission approval itself does not start or resume downloads.

These are application and browser-handle guards. Windows junction/reparse-point isolation is not independently enforced by the extension; an OS-level no-follow boundary would need a native helper.

## Transfers and recovery

Durable jobs preserve scan cursors and completed file state. Supported large transfers checkpoint closed private chunks with strong validators and checked byte ranges. Partial data stays in the extension cache, not in creator folders.

Source hashes and bounded byte comparisons preserve exact duplicate handling. Conflicting outputs are retained under another filename. Automatic/bulk sync keeps compressed originals; manual removal after extraction requires verified source and output identities.

See [sync details](AUTO_SYNC.md), [test plan](TEST_PLAN.md) and [development/release steps](DEVELOPMENT.md).
