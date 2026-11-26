(() => {
  "use strict";
  const manifestUrl = new URL("releases/latest.json", location.href);
  const filename = (value, extension) =>
    typeof value === "string" && new RegExp("^[a-z0-9][a-z0-9._-]+\\." + extension + "$", "i").test(value);
  const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
  function checkedManifest(data) {
    const date = new Date(data?.releaseDate + "T00:00:00Z");
    if (!/^\d+\.\d+\.\d+$/.test(data?.version) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(data?.releaseDate) || Number.isNaN(+date) ||
        date.toISOString().slice(0, 10) !== data.releaseDate ||
        !filename(data.file, "xlsx") || !digest(data.sha256) ||
        !filename(data.distribution?.file, "zip") || !digest(data.distribution?.sha256) ||
        !filename(data.releaseNotes, "md") ||
        !["main", "optional", "documentary", "future"].every((key) =>
          Number.isSafeInteger(data.inventory?.[key]) && data.inventory[key] >= 0) ||
        !["format", "tested", "excel"].every((key) =>
          typeof data.compatibility?.[key] === "string" && data.compatibility[key].trim())) {
      throw new Error("The release manifest is invalid.");
    }
    return data;
  }
  function releaseUrl(file, checksum) {
    const url = new URL(file, manifestUrl);
    if (checksum) url.searchParams.set("sha256", checksum.toLowerCase());
    return url;
  }
  function request(url, cache = "no-cache") {
    return fetch(url, { cache, credentials: "omit", redirect: "error" }).then((response) => {
      if (!response.ok) throw new Error("The release file could not be loaded.");
      return response;
    });
  }
  const refresh = () => request(manifestUrl, "no-store").then((response) => response.json()).then(checkedManifest);
  const latest = refresh();
  function fill(data) {
    const date = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" })
      .format(new Date(data.releaseDate + "T00:00:00Z"));
    const text = {
      version: "v" + data.version, date, ...data.inventory, ...data.compatibility,
      sha256: data.sha256, distributionSha256: data.distribution.sha256,
    };
    for (const node of document.querySelectorAll("[data-release]")) {
      const value = text[node.dataset.release];
      if (value !== undefined) node.textContent = typeof value === "number" ? value.toLocaleString() : value;
    }
    const files = { workbook: data.file, distribution: data.distribution.file, notes: data.releaseNotes };
    const checksums = { workbook: data.sha256, distribution: data.distribution.sha256 };
    for (const link of document.querySelectorAll("[data-release-file]")) {
      const key = link.dataset.releaseFile;
      if (files[key]) { link.href = releaseUrl(files[key], checksums[key]); link.hidden = false; }
    }
    for (const node of document.querySelectorAll("[data-release-ready]")) node.hidden = false;
    for (const node of document.querySelectorAll("[data-release-loading]")) node.hidden = true;
  }
  latest.then(fill).catch(() => {
    for (const node of document.querySelectorAll("[data-release-loading]")) node.hidden = true;
    for (const node of document.querySelectorAll("[data-release-error]")) node.hidden = false;
  });
  async function workbook(data) {
    if (!globalThis.crypto?.subtle) throw new Error("Use HTTPS or localhost for the automatic download, or select a local workbook.");
    const response = await request(releaseUrl(data.file, data.sha256));
    const bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
    if (hash !== data.sha256.toLowerCase()) throw new Error("The workbook checksum did not match. Select a trusted local copy.");
    return new File([bytes], data.file, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  async function configureIssues() {
    try {
      const config = await request(new URL("site-config.json", location.href)).then((response) => response.json());
      if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(config?.githubRepository) ||
          /(?:^|\/)\.{1,2}$/.test(config.githubRepository)) return;
      for (const link of document.querySelectorAll("[data-issue-link]")) {
        const url = new URL("https://github.com/" + config.githubRepository + "/issues/new");
        url.searchParams.set("template", link.dataset.issueLink);
        link.href = url;
        link.hidden = false;
      }
    } catch { /* The issue guide remains readable before a repository is configured. */ }
  }
  if (document.querySelector("[data-issue-link]")) configureIssues();
  async function latestWorkbook() {
    const data = await refresh();
    fill(data);
    return workbook(data);
  }
  window.CommunityRelease = Object.freeze({ latest, latestWorkbook });
})();
