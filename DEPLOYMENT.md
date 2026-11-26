# Local review and GitHub Pages deployment

## Review locally

From this extracted repository folder, serve the site with a static HTTP server. For a maintainer with Python installed, the existing OS terminal can run either command. Visitors to the hosted site need only a browser.

```powershell
py -3 -m http.server 8000 --bind 127.0.0.1 --directory docs
```

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory docs
```

Open **http://localhost:8000/**. Use HTTP on localhost or HTTPS. Opening the HTML as a file does not support the automatic workbook fetch and checksum flow.

## Deploy after approval

If the organization uses GitHub Free, GitHub Pages requires a public repository. Confirm visibility before launch. [GitHub Pages plan requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

1. Commit this repository tree to the approved GitHub repository, including `.github/ISSUE_TEMPLATE/` and `docs/.nojekyll`. Keep internal QA, private workbooks, and recovery archives outside it.
2. The repository is configured as `MultiverseArchivist/expanded-mcu-multiverse` in `docs/site-config.json`. Confirm all three issue templates on the default branch and check that GitHub Issues is enabled.
3. In **Settings → Pages**, choose **Deploy from a branch**, choose the intended branch and **/docs**, then save. Use the published HTTPS URL and run the workbook acceptance checklist. Assets, downloads, and navigation use relative paths for GitHub project hosting. The site has no backend, accounts, database, analytics, or build step.
4. Verify the [public site](https://multiversearchivist.github.io/expanded-mcu-multiverse/), workbook and ZIP downloads, and issue links once live. Keep the [license scope](LICENSING.md), license texts, and existing JSZip notice with the files.

[GitHub Pages publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [GitHub issue template instructions](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)
