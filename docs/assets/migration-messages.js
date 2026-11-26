(() => {
  "use strict";
  const workbookNames = { old: "Existing workbook", new: "Target workbook", old_baseline: "Optional comparison workbook" };
  const fieldNames = {
    status: "Status", rating: "Rating", completed_on: "Completion date", actual_minutes: "Actual minutes",
    personal_notes: "Personal notes", custom_access: "Personal link", "old provider link": "Provider link",
    "old planning minutes": "Planning minutes", "old content notes": "Content notes",
  };
  const location = (row) => [row.sheet, row.row === undefined ? null : `row ${row.row}`].filter(Boolean).join(", ");
  function describe(report, success) {
    const issues = [];
    const add = (entry, side, detail, id = entry.id) => issues.push({
      title: entry.title || "Entry title unavailable",
      location: [workbookNames[side], location(entry)].filter(Boolean).join(" · "),
      detail,
      id,
    });
    for (const entry of report.review ?? []) add(entry, "new",
      `${fieldNames[entry.field] || entry.field}: ${entry.reason} Check the report before replacing your working copy.`);
    for (const entry of report.removed ?? []) add(entry, "old",
      "This entry is missing from the target edition. Keep your existing workbook and review the report.");
    for (const [side, entries] of Object.entries(report.missing_or_invalid_ids ?? {})) {
      for (const entry of entries) add(entry, side, side === "new"
        ? "Missing or invalid permanent ID. Download a fresh target workbook or report this entry."
        : "Missing or invalid permanent ID. Check this entry against an original copy or ask the maintainer for help.");
    }
    for (const [side, list] of Object.entries(report.duplicates ?? {})) {
      for (const [id, entries] of Object.entries(list)) {
        const recovery = side === "new" ? "Choose a fresh target workbook."
          : side === "old_baseline" ? "Replace or remove the optional comparison file."
          : "Use an undamaged backup or ask the maintainer to review the duplicates.";
        for (const entry of entries) add(entry, side, `Duplicate permanent ID. ${recovery}`, id);
      }
    }
    for (const entry of report.target_progress_entries ?? []) add(entry, "new",
      "This entry already has progress. Use a fresh Community Edition as your target.");
    if (report.target_has_progress?.length && !report.target_progress_entries?.length) {
      add({ title: "The target workbook has existing progress" }, "new", "Select a fresh Community Edition.");
    }
    for (const [side, tabs] of Object.entries(report.project_sheets_without_ids ?? {})) {
      for (const sheet of tabs) add({ title: sheet }, side,
        "This worksheet predates permanent project IDs. Check the skipped rows in your original workbook.");
    }
    let outcome;
    if (success) {
      outcome = issues.length
        ? "Migration complete. Review the flagged entries before switching copies."
        : "Migration complete.";
    } else if (report.result === "blocked: invalid or unsupported workbook") {
      const name = workbookNames[report.error_context];
      outcome = name
        ? `${name} could not be read as a supported .xlsx workbook. Select a valid Community workbook and try again.`
        : "The selected files could not be read or processed as supported .xlsx workbooks. Select another copy and try again.";
    } else if (report.target_has_progress?.length) {
      outcome = "The target already contains progress. Choose a fresh Community Edition and try again.";
    } else {
      outcome = "Workbook IDs could not be matched safely. Use the entries below to choose a fresh file or check your backup, then try again.";
    }
    return { outcome, issues };
  }
  globalThis.MigrationMessages = Object.freeze({ describe });
})();
