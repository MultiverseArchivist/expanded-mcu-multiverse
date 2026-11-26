# Refresh a release

1. Copy the approved blank-progress Community XLSX, public distribution ZIP, and public release notes Markdown into `docs/releases/`. Keep private workbooks and internal material outside this repository. Use filenames made from letters, digits, periods, underscores, and hyphens.
2. Update `docs/releases/latest.json` in the same change. Set `version`, `releaseDate` (YYYY-MM-DD), inventory counts, workbook filename and SHA-256, ZIP filename and SHA-256, compatibility details, and the release-notes filename. The homepage, downloads, compatibility badge and updater read this manifest. Until approval, the date marks the staged package. Update it to the actual release date when publishing.
3. Run `python3 tools/fingerprint_assets.py` after changes to HTML, JavaScript, CSS, the favicon, or the bundled library. Then run `python3 tools/fingerprint_assets.py --check` before packaging. Commit the refreshed HTML and asset files together. Each URL fingerprint is calculated from the asset bytes, so edits refresh the resource even when the public version is unchanged. GitHub Pages serves the generated HTML directly. Visitors need no Python installation.
4. Verify both manifest hashes against the committed files, run the browser acceptance checklist, and confirm navigation under the repository path. The manifest bypasses the browser cache on page load and on every automatic upgrade attempt. The workbook URL includes the published checksum, and the upgrader verifies SHA-256 before migration. The Download section publishes both checksums.
5. Keep prior public release notes for historical reference and add any historic entries to `docs/changelog.html`. Current release details populate from the manifest. Refresh the repository README when the public scope or instructions change.
6. To update JSZip, replace the local versioned file and its exact license notice, update the script path in `docs/update.html`, refresh its fingerprint, and rerun the migration and browser tests. Keep the Python alternative and its guide in `docs/offline/`.

When rolling back, restore the previous manifest and its referenced release files together. GitHub Pages serves the repository files without a backend.

## Workbook opening positions

Before calculating the download hashes, run the maintainer-only release-view procedure from the internal release toolkit. For inaugural v3.0.0, use `--inaugural` to select and scroll to the first permanent entry on each content worksheet. For subsequent releases, start with the previous designated opening positions. Supply a permanent ID for the newest added or materially updated entry on each changed content worksheet. Omit sheets without content changes to carry their positions forward. Dashboard is the active tab at A1. Marathon Hub and the analysis tabs open at A1. Browser and offline migration preserve the target's opening positions.

Validate the resulting workbook before packaging. Excel may open Internet downloads in Protected View. Keep the application's normal security settings in place.
