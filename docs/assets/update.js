(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const form = $("upgrade-form");
  let objectUrls = [];
  let running = false;

  function offerLocal() {
    $("latest-status").textContent = "The latest release could not be loaded. Choose a fresh local workbook.";
    form.elements.target.value = "local";
    updateTarget();
  }

  CommunityRelease.latest.then((release) => {
    $("latest-status").textContent = `Community Edition v${release.version}`;
  }).catch(() => {
    if (form.elements.target.value === "latest") offerLocal();
    else $("latest-status").textContent = "The latest release is unavailable.";
  });

  const oldPicker = $("old");
  const zone = $("drop-zone");
  for (const name of ["dragenter", "dragover"]) zone.addEventListener(name, (event) => {
    event.preventDefault();
    zone.classList.add("is-dragging");
  });
  zone.addEventListener("dragleave", (event) => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove("is-dragging");
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragging");
    if (running) return;
    const files = event.dataTransfer.files;
    if (files.length !== 1 || !/\.xlsx$/i.test(files[0].name)) {
      $("activity").textContent = "Choose one .xlsx workbook.";
      return;
    }
    oldPicker.files = files;
    oldPicker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  oldPicker.addEventListener("change", () => {
    $("selected").textContent = oldPicker.files[0] ? `Selected: ${oldPicker.files[0].name}` : "";
    if (!running) $("activity").textContent = "";
  });

  function updateTarget() {
    const local = form.elements.target.value === "local";
    $("local").hidden = !local;
    $("local").required = local;
  }

  function resetResults() {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls = [];
    for (const id of ["file-link", "report-link"]) $(id).removeAttribute("href");
    $("results").hidden = true;
  }

  function download(file, bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    objectUrls.push(url);
    $(file).href = url;
  }

  function showResults({ report, workbook }) {
    $("results").hidden = false;
    $("result-title").textContent = workbook ? "Your upgraded workbook is ready" : "The upgrade stopped";
    const { outcome, issues } = MigrationMessages.describe(report, Boolean(workbook));
    $("outcome").textContent = outcome;
    $("success-guidance").hidden = !workbook;
    const fields = { status: "Statuses copied", rating: "Ratings copied", completed_on: "Completion dates copied",
      actual_minutes: "Actual times copied", personal_notes: "Personal notes copied", custom_access: "Personal links copied" };
    const numbers = Object.entries(report.copied_fields ?? {}).map(([field, number]) => [fields[field], number]);
    if (workbook) numbers.push(["Entries added", report.new_entries.length], ["Entries moved", report.moved.length]);
    $("counts").replaceChildren(...numbers.flatMap(([label, count]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const value = document.createElement("dd");
      value.textContent = count;
      return [term, value];
    }));
    $("issues").replaceChildren(...issues.slice(0, 100).map((issue) => {
      const row = document.createElement("li");
      const heading = document.createElement("strong");
      heading.textContent = issue.title;
      row.append(heading);
      if (issue.location) {
        const place = document.createElement("p");
        place.className = "hint";
        place.textContent = issue.location;
        row.append(place);
      }
      const detail = document.createElement("p");
      detail.textContent = issue.detail;
      row.append(detail);
      if (issue.id) {
        const id = document.createElement("p");
        id.className = "hint";
        id.textContent = `Permanent ID: ${issue.id}`;
        row.append(id);
      }
      return row;
    }));
    if (issues.length > 100) {
      const row = document.createElement("li");
      row.textContent = `${issues.length - 100} further items are in the download report.`;
      $("issues").append(row);
    }
    $("details").hidden = !issues.length;
    $("details").open = Boolean(issues.length && !workbook);
    $("file-link").hidden = !workbook;
    if (workbook) download("file-link", workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    download("report-link", JSON.stringify(report, null, 2) + "\n", "application/json");
    $("result-title").focus();
  }

  form.addEventListener("change", () => {
    updateTarget();
    if (!running) resetResults();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (running) return;
    const old = $("old").files[0];
    const baseline = $("baseline").files[0];
    const useLocal = form.elements.target.value === "local";
    const local = $("local").files[0];
    if (!old || (useLocal && !local)) return;
    resetResults();
    running = true;
    $("run").disabled = true;
    $("working").hidden = false;
    $("activity").textContent = "Preparing the upgrade…";
    try {
      let target = local;
      if (!useLocal) {
        $("activity").textContent = "Downloading and verifying the latest Community workbook…";
        try { target = await CommunityRelease.latestWorkbook(); }
        catch (error) { offerLocal(); throw error; }
      }
      $("activity").textContent = "Matching entries and preparing your download…";
      const { report, workbook } = await CommunityMigration.migrate(old, target, baseline);
      showResults({ report, workbook });
      $("activity").textContent = "";
    } catch {
      $("activity").textContent = useLocal
        ? "The upgrade could not finish. Select another workbook and try again. Your originals are unchanged."
        : "The latest workbook could not be downloaded or verified. Select a fresh local Community workbook. Your original is unchanged.";
    } finally {
      running = false;
      $("run").disabled = false;
      $("working").hidden = true;
    }
  });
  updateTarget();
})();
