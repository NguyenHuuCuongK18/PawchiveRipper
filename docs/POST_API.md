# Post discovery and media

A post scope contains the supported source origin, provider, creator ID and optional post ID. IDs remain strings; prefixed IDs such as `p-{postId}` are accepted where supported.

List discovery handles the documented route variants and validates creator/provider identity. Individual unreadable records and exhausted pages are tracked as explicit failures so available posts can still be saved and gaps retried.

Normalization includes the main file even when `attachments` is empty. Media identities accept canonical and partitioned storage paths; thumbnails use the corresponding canonical unpartitioned path. Downloaded bytes determine image extensions.

Creator-folder history records source identity, saved selection/scope, retained file paths, shared targets and optional text/extraction fingerprints. A connection to another post never silently broadens a saved single-post/subset scope.

The generated main-file fixture is `tests/fixtures/post-10001.synthetic.json`. Browser acceptance covers controlled media hosts, edited text, folder continuation and exact-byte saving. No live creator data is required by these tests.

See [API compatibility](API_RECON.md), [sync behavior](AUTO_SYNC.md) and [release validation](RELEASE_CHECK.md).
