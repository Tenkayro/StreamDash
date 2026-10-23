# Microsoft Store package

`npm run msix` builds an unsigned x64 Store package at:

`src-tauri/target/release/bundle/msix/StreamDash-Store.msix`

Before uploading it to Partner Center, copy the reserved package identity and
publisher exactly into `store.json`. The same values can be supplied temporarily
with `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER`, `MSIX_PUBLISHER_DISPLAY_NAME`,
`MSIX_DISPLAY_NAME`, and `MSIX_DESCRIPTION`.

The package is deliberately not signed locally. Microsoft signs MSIX packages
after Store certification.

At runtime, StreamDash detects the MSIX package identity and switches to the
native Microsoft Store update check. Store builds never download or install the
standalone GitHub MSI updater. When an update is available, the title bar opens
the official Microsoft Store downloads and updates page.

`npm run release` creates the MSI, updater files, and MSIX locally. It does not
commit, tag, push, or create a GitHub release.
