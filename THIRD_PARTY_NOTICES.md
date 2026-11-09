# Third-party notices

Pawchive Ripper's original code, generated icons and synthetic test assets use the [MIT License](LICENSE). Dependencies retain their own licenses. The extension's license does not grant rights to content downloaded from archive sites.

## Included in the extension ZIP

| Component | Version | License / included notice |
| --- | --- | --- |
| [zip.js](https://github.com/gildas-lormeau/zip.js) | 2.23.0 | BSD-3-Clause; `zip.js-LICENSE.txt` |
| [libarchive-wasm](https://github.com/ofk/libarchive-wasm) | 1.2.0 | MIT; `licenses/libarchive-wasm-LICENSE.txt` |
| libarchive | 3.7.7 | Upstream BSD and per-file notices; `licenses/libarchive-COPYING.txt` and `licenses/libarchive-rar-source-notice.txt` |
| zlib | 1.3.1 | zlib; `licenses/zlib-LICENSE.txt` |
| bzip2 | 1.0.8 | bzip2 license; `licenses/bzip2-LICENSE.txt` |
| XZ / liblzma | 5.6.4 | Upstream component-specific terms; `licenses/xz-COPYING.txt` |
| OpenSSL | 3.4.1 | Apache-2.0; `licenses/OpenSSL-LICENSE.txt` |
| Emscripten runtime | 4.0.5 | MIT / University of Illinois/NCSA terms; `licenses/emscripten-LICENSE.txt` |
| Vite-generated runtime helper | See `package-lock.json` | MIT; `licenses/vite-LICENSE.txt` (the complete upstream notice is included) |

The decoder component versions above follow libarchive-wasm's upstream [build recipe](https://github.com/ofk/libarchive-wasm/blob/main/lib/Dockerfile). All supplied decoder notices are retained in `licenses/`; they are not replaced by this project's MIT license.

## Development and fixtures

Build and test tools are not included in the installable ZIP. Their versions and SPDX license identifiers are recorded in `package-lock.json`; their complete license files are installed with `npm ci`.

The JPEG used by the browser tests is generated from geometric canvas shapes by `scripts/make-test-image.mjs`. It contains no creator artwork. Sanitized metadata/HTML fixtures retain public identities and URL shapes for compatibility tests and do not include referenced artwork. RAR fixtures come from libarchive's test suite under its upstream terms; see [fixture provenance](tests/fixtures/archives/README.md). The generated 7z/TAR fixtures contain synthetic text.
