# Development and releases

Use Node.js 24 LTS and the committed npm lockfile. The supported Node ranges are in `package.json`. Install Chromium with Playwright after `npm ci`.

```sh
npm ci
npx playwright install chromium
npm run check
```

`check` runs unit tests, TypeScript checking and the production build. Load `dist/` in the browser. Runtime code is under `src/`; build/release scripts, tests and fixture provenance are separate.

## Browser checks

All browser checks use isolated profiles and synthetic media; they do not use a personal browser profile or download a live creator archive.

```sh
npm run test:browser
npm run test:acceptance
npm run test:selection
npm run test:tolerance
npm run test:settings
npm run test:compatibility
npm run test:duplicates
```

The coexistence check loads the independent Blocklist extension from `../PawchiveBlockList/extension`. Clone that project alongside this one, or set `PAWCHIVE_BLOCKLIST_DIR` to its `extension` directory. CI checks out Blocklist v1.0.0 into `.compat-blocklist/` and supplies that variable. The sibling is a test fixture dependency only.

`npm run fixtures:image` regenerates the original geometric JPEG used by browser tests. Captured live media is not a test asset. Optional recon scripts write ignored captures under `artifacts/`; review and sanitize metadata deliberately before replacing committed fixtures.

## Packaging

```sh
npm run release:check
```

The release gate builds, runs the seven browser suites, writes `releases/pawchive-ripper-VERSION.zip` and `releases/SHA256SUMS.txt`, then verifies exact build bytes, ZIP signatures, manifest/package versions, notices and checksum. The ZIP has `manifest.json` at its root and includes `LICENSE`, `THIRD_PARTY_NOTICES.md` and dependency notices.

Only `dist/` is packaged. Dependencies, source, tests, browser profiles, screenshots, editor settings and source-control data stay out. ZIPs and generated output are ignored in Git. Original source/fixture licensing and bundled dependencies are documented in the root third-party notice.

`npm run clean` validates fixed targets inside the project root before removing `artifacts/`, generated test profiles, coverage, local release output and old legacy extension ZIPs. It preserves `src/`, `tests/`, `node_modules/` and `dist/`. It never traverses a user-selected archive folder. Run cleanup after reviewing test reports and before packaging again if you want a clean working directory.

## Publishing

1. Update `package.json`, the root package entries in `package-lock.json`, `src/manifest.json`, the changelog and the versioned usage/release links.
2. Add `docs/releases/vVERSION.md` with changes, limitations and install/update steps.
3. Run the release gate and inspect the ZIP/checksum. Commit source and documentation; keep generated packages out of commits.
4. Push `main` and an annotated `vVERSION` tag without rewriting published history.
5. Publish the ZIP and `SHA256SUMS.txt` using the versioned notes. The **Publish release** workflow can validate an existing tag and publish it; it refuses to overwrite an existing release.

CI validates pull requests and main-branch pushes on Linux/Node 24 and uploads the verified package as a workflow artifact. Actions are pinned to immutable commits. The publish workflow is manual so a tag push cannot race a separately reviewed release.
