# Third-party notices — LitFinch for Zotero 0.7.0

## Distributed XPI

The Connector XPI contains the project's JavaScript, manifest, SVG icon, Fluent
strings, this notice and the complete AGPL-3.0-only license. Copyright (C) 2026
lvyrana. See `LICENSE` for the full terms.

No third-party JavaScript library, font, native binary, npm dependency, Python
package, PDF, user reading record or credential is bundled in this XPI.

## Host software and services

- Zotero and its embedded Firefox/Gecko and PDF.js components are provided by the
  user's Zotero installation. The Connector calls their APIs; it does not copy or
  redistribute their implementation. See https://www.zotero.org/support/licensing
  and https://github.com/zotero/zotero for Zotero's own notices.
- Node.js, Python, zip and unzip are build/verification tools, not XPI members.
  Playwright and its browser are used only for development tests.
- The configured LitFinch server and model providers are remote services. Their
  dependencies and service terms are not included in, or licensed by, this XPI.

## Scope of this inventory

The same JavaScript-only XPI is built for supported Zotero installations; it has
no OS-specific payload. Native acceptance currently covers macOS with Zotero
9.0.6. This does not establish Windows/Linux compatibility.

`node scripts/check-package.mjs` verifies the exact archive member allowlist and
compares every member with the build source, including the full license. It
rejects unexpected files and source mismatches. Re-review this inventory whenever
the bundled payload changes.
