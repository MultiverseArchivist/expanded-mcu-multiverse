/* Community XLSX migration. Mirrors the local Python utility's data rules. */
(() => {
  "use strict";
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const sheets = ["Canon Release Checklist", "Optional & Excluded", "Documentaries & Extras"];
  const projectSheets = ["Future Releases", "Canceled & Reworked"];
  const idHeaders = ["permanent entry id", "permanent optional id", "permanent documentary id", "permanent id"];
  const headers = {
    status: ["status", "viewing status", "reading status"],
    rating: ["rating", "rating (1–10)", "rating (1-10)", "personal rating (1–10)", "personal rating (1-10)"],
    completed_on: ["completed on", "completed on (yyyy-mm-dd)", "completion date"],
    actual_minutes: ["actual minutes", "actual time (min)", "actual viewing minutes", "actual reading minutes", "actual viewing / reading minutes", "actual viewing or reading minutes"],
    personal_notes: ["personal notes", "my notes", "user notes"],
    custom_access: ["my access link", "custom access link", "personal access link", "user access link", "user-customized access link"],
  };
  const legacyHeaders = {
    legacy_access: ["watch or read link", "public provider / store link", "watch / read url (dashboard lookup)", "watch / read url", "watch or read url"],
    legacy_minutes: ["minutes (est.)", "minutes (estimated)"],
    legacy_notes: ["notes", "content notes", "runtime / access notes"],
  };
  const statuses = ["Not Started", "Completed", "In Progress", "On Hold"];
  const address = /^([A-Z]+)([0-9]+)$/;
  const idFormat = /^[A-Z][A-Z0-9]*-[0-9]+$/;
  const blank = { kind: "text", data: "" };
  const normal = (value) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const empty = (value) => value.data === "" && value.kind !== "formula";
  const same = (a, b) => a.kind === b.kind && a.data === b.data;
  const children = (node, name) => Array.from(node?.children ?? []).filter((el) => el.localName === name);
  const child = (node, name) => children(node, name)[0];
  const text = (node) => node?.textContent ?? "";
  const richText = (node) => Array.from(node?.children ?? []).map((el) => {
    if (el.localName === "t") return text(el);
    return el.localName === "r" ? text(child(el, "t")) : "";
  }).join("");
  const columnOf = (cell) => {
    const match = address.exec(cell.getAttribute("r"));
    if (!match) throw new Error("A workbook cell has an invalid address.");
    return match[1];
  };
  const columnNumber = (col) => [...col].reduce((value, letter) => 26 * value + letter.charCodeAt(0) - 64, 0);
  const element = (parent, name) => parent.ownerDocument.createElementNS(ns, parent.prefix ? `${parent.prefix}:${name}` : name);

  async function readXml(zip, path) {
    const file = zip.file(path);
    if (!file) throw new Error(`Workbook part is missing: ${path}.`);
    const raw = await file.async("string");
    if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error("Unsupported XML declaration.");
    const doc = new DOMParser().parseFromString(raw, "application/xml");
    if (doc.getElementsByTagNameNS("*", "parsererror").length) throw new Error("A workbook part contains invalid XML.");
    return { doc, raw };
  }

  function worksheetPath(target) {
    if (!target || /[\\:?#]/.test(target) || target.startsWith("//")) throw new Error("Unsupported worksheet relationship.");
    const path = new URL(target, "https://workbook.invalid/xl/").pathname.slice(1);
    if (!/^xl\/.+\.xml$/.test(path)) throw new Error("Worksheet relationship points outside the workbook.");
    return path;
  }

  function personal(values) {
    return Object.fromEntries(Object.entries(values).filter(([field, value]) =>
      field in headers && !empty(value) && !(field === "status" && normal(value.data) === "not started"))
      .map(([field, value]) => [field, value.data]));
  }

  function unmatched(entry) {
    const result = { ...entry.location, personal_fields: personal(entry.values) };
    const link = entry.values.legacy_access;
    if (link && !empty(link)) result.prior_provider_link = link.data;
    return result;
  }

  async function loadWorkbook(input) {
    if (input.size > 25 * 1024 * 1024) throw new Error("Choose a Community workbook smaller than 25 MB.");
    const zip = await JSZip.loadAsync(await input.arrayBuffer());
    const workbook = (await readXml(zip, "xl/workbook.xml")).doc;
    const links = (await readXml(zip, "xl/_rels/workbook.xml.rels")).doc;
    const targets = new Map(children(links.documentElement, "Relationship").map((el) =>
      [el.getAttribute("Id"), el.getAttribute("TargetMode") === "External" ? null : el.getAttribute("Target")]));
    const strings = zip.file("xl/sharedStrings.xml")
      ? children((await readXml(zip, "xl/sharedStrings.xml")).doc.documentElement, "si").map(richText) : [];
    const date1904 = ["1", "true"].includes(child(workbook.documentElement, "workbookPr")?.getAttribute("date1904"));
    const result = { zip, workbook, date1904, paths: new Map(), docs: new Map(), changed: new Set(), index: new Map(), duplicates: {}, missing: [], legacyProjectSheets: [] };
    function valueOf(cell) {
      if (!cell) return blank;
      const type = cell.getAttribute("t");
      const raw = text(child(cell, "v"));
      const formula = child(cell, "f");
      if (formula) return { kind: "formula", data: "=" + text(formula) };
      if (type === "inlineStr") return { kind: "text", data: richText(child(cell, "is")) };
      if (type === "s") {
        const entry = /^\d+$/.test(raw) ? strings[Number(raw)] : undefined;
        if (entry === undefined) throw new Error("Invalid shared string reference.");
        return { kind: "text", data: entry };
      }
      return { kind: { str: "text", d: "date", e: "error", b: "boolean" }[type] ?? "number", data: raw };
    }
    for (const tab of children(child(workbook.documentElement, "sheets"), "sheet")) {
      const name = tab.getAttribute("name");
      const path = worksheetPath(targets.get(tab.getAttributeNS(rel, "id")));
      result.paths.set(name, path);
      if (![...sheets, ...projectSheets].includes(name)) continue;
      const parsed = await readXml(zip, path);
      result.docs.set(name, parsed);
      const rows = children(child(parsed.doc.documentElement, "sheetData"), "row");
      const header = rows.find((row) => row.getAttribute("r") === "1");
      const labels = new Map(children(header, "c").map((cell) => [columnOf(cell), normal(valueOf(cell).data)]));
      const matches = (names) => [...labels].filter(([, label]) => names.includes(label)).map(([col]) => col);
      const ids = matches(idHeaders);
      if (!ids.length && projectSheets.includes(name)) { result.legacyProjectSheets.push(name); continue; }
      if (ids.length !== 1) throw new Error(`${name} must have exactly one permanent ID column.`);
      const columns = {};
      for (const [field, names] of Object.entries({ ...headers, ...legacyHeaders })) {
        const cols = matches(names);
        if (cols.length > 1 && field in headers) throw new Error(`${name} has more than one column for ${field}.`);
        if (cols.length) columns[field] = cols.at(field === "legacy_minutes" || field === "legacy_notes" ? -1 : 0);
      }
      const titleColumn = matches(["title / episode", "title", "project / original title"])[0] ?? "B";
      for (const row of rows) {
        if (row === header) continue;
        const cells = new Map(children(row, "c").map((cell) => [columnOf(cell), cell]));
        const value = (col) => valueOf(cells.get(col));
        const idValue = value(ids[0]);
        const id = idValue.data.trim().toUpperCase();
        const title = value(titleColumn).data;
        const values = Object.fromEntries(Object.entries(columns).map(([field, col]) => [field, value(col)]));
        const entry = { row, columns, values, location: { sheet: name, row: Number(row.getAttribute("r")), title } };
        if (!id && !title && !Object.keys(personal(values)).length) continue;
        if (idValue.kind !== "text" || !idFormat.test(id)) {
          result.missing.push({ id: idValue.data, ...unmatched(entry) });
        } else if (result.index.has(id)) {
          (result.duplicates[id] ??= [result.index.get(id).location]).push(entry.location);
        } else {
          result.index.set(id, entry);
        }
      }
    }
    if (sheets.some((name) => !result.docs.has(name))) throw new Error("Choose a workbook with the three Community inventory worksheets.");
    return result;
  }

  function numeric(value) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return NaN;
    return Number(value);
  }

  function checked(field, value, old, target) {
    if (["formula", "error", "boolean"].includes(value.kind)) throw new Error("Only plain personal values can be imported.");
    if (field === "status") {
      const status = statuses.find((item) => normal(item) === normal(value.data));
      if (!status) throw new Error("Unknown progress status.");
      return { kind: "text", data: status };
    }
    if (["rating", "actual_minutes"].includes(field)) {
      const n = numeric(value.data);
      if (!Number.isFinite(n) || n < (field === "rating" ? 1 : 0) || (field === "rating" && n > 10)) throw new Error("Value is outside the supported range.");
      return { kind: "number", data: String(n) };
    }
    if (field === "completed_on") {
      if (value.kind === "number") {
        let n = numeric(value.data);
        if (!Number.isFinite(n) || n < 0) throw new Error("Invalid spreadsheet completion date.");
        if (old.date1904 !== target.date1904) {
          if (!old.date1904 && n <= 60) throw new Error("Early 1900 dates cannot be transferred between date systems.");
          n += old.date1904 ? 1462 : -1462;
          if (n < 0) throw new Error("Date predates the target workbook date system.");
        }
        return { kind: "number", data: String(n) };
      }
      let date = value.kind === "date" ? value.data.slice(0, 10) : value.data;
      if (/^\d{8}$/.test(date)) date = date.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
      const parsed = new Date(date + "T00:00:00Z");
      if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error("Invalid completion date. Use YYYY-MM-DD.");
      }
      return { kind: "text", data: date };
    }
    if (field === "custom_access") {
      let url;
      try { url = new URL(value.data); } catch { /* Report invalid links for review. */ }
      if (!/^https?:\/\//i.test(value.data) || !url?.hostname || url.username || url.password) throw new Error("Custom links must be plain HTTP(S) URLs without embedded credentials.");
    }
    return { kind: "text", data: value.data };
  }

  function put(entry, field, value) {
    const col = entry.columns[field];
    const cells = children(entry.row, "c");
    let cell = cells.find((item) => columnOf(item) === col);
    if (!cell) {
      cell = element(entry.row, "c");
      cell.setAttribute("r", col + entry.row.getAttribute("r"));
      const next = cells.find((item) => columnNumber(columnOf(item)) > columnNumber(col));
      entry.row.insertBefore(cell, next ?? null);
    }
    cell.removeAttribute("t");
    for (const el of [...cell.children]) if (["v", "is", "f"].includes(el.localName)) el.remove();
    if (value.kind === "text") {
      cell.setAttribute("t", "inlineStr");
      const inline = cell.appendChild(element(cell, "is"));
      const content = inline.appendChild(element(inline, "t"));
      content.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
      content.textContent = value.data;
    } else {
      cell.appendChild(element(cell, "v")).textContent = value.data;
    }
  }

  function transfer(old, target, baseline, report) {
    report.duplicates = { old: old.duplicates, new: target.duplicates };
    if (baseline) report.duplicates.old_baseline = baseline.duplicates;
    report.missing_or_invalid_ids = { old: old.missing, new: target.missing };
    if (old.legacyProjectSheets.length || target.legacyProjectSheets.length) report.project_sheets_without_ids = { old: old.legacyProjectSheets, new: target.legacyProjectSheets };
    report.removed = [...old.index].filter(([id]) => !target.index.has(id)).map(([id, entry]) => ({ id, ...unmatched(entry) }));
    report.new_entries = [...target.index].filter(([id]) => !old.index.has(id)).map(([id, entry]) => ({ id, ...entry.location }));
    if (Object.values(report.duplicates).some((group) => Object.keys(group).length) || target.missing.length) {
      report.result = "blocked: duplicate IDs or missing IDs in the target";
      return false;
    }
    report.copied_fields = {};
    report.moved = [];
    report.review = [];
    const dirty = [...target.index].filter(([, entry]) => Object.keys(personal(entry.values)).length).map(([id]) => id);
    if (dirty.length) {
      report.target_progress_entries = dirty.map((id) => ({ id, ...target.index.get(id).location }));
      report.result = "blocked: target must be a fresh workbook with default progress";
      report.target_has_progress = dirty;
      return false;
    }
    for (const [id, source] of old.index) {
      const dst = target.index.get(id);
      if (!dst) continue;
      if (source.location.sheet !== dst.location.sheet) report.moved.push({ id, from: source.location.sheet, to: dst.location.sheet });
      const values = { ...source.values };
      const original = baseline?.index.get(id);
      for (const [field, label] of [["legacy_minutes", "old planning minutes"], ["legacy_notes", "old content notes"]]) {
        const previous = values[field] ?? blank;
        delete values[field];
        if (original && !empty(previous) && !same(previous, original.values[field] ?? blank)) {
          report.review.push({ id, field: label, old_value: previous.data, ...dst.location, reason: "Edited official metadata field. Review for personal data to save separately." });
        }
      }
      const legacy = values.legacy_access ?? blank;
      delete values.legacy_access;
      const fresh = dst.values.legacy_access ?? blank;
      if (!empty(legacy) && !same(legacy, fresh) && (!original || !same(legacy, original.values.legacy_access ?? blank))) {
        if (original && empty(values.custom_access ?? blank)) values.custom_access = legacy;
        else report.review.push({ id, field: "old provider link", old_value: legacy.data, new_official_link: fresh.data, ...dst.location, reason: original ? "A dedicated personal link already exists." : "Older official link or user override. Review manually." });
      }
      for (const [field, value] of Object.entries(values)) {
        if (empty(value) || (field === "status" && normal(value.data) === "not started")) continue;
        const issue = { id, field, old_value: value.data, ...dst.location };
        if (!(field in dst.columns)) {
          report.review.push({ ...issue, reason: "The target sheet has no matching dedicated personal field." });
          continue;
        }
        if (field === "custom_access" && !empty(fresh) && !same(value, fresh)) {
          report.review.push({ ...issue, reason: "Kept the official provider link and copied the separate personal link if valid.", new_official_link: fresh.data });
        }
        try { put(dst, field, checked(field, value, old, target)); }
        catch (error) { report.review.push({ ...issue, reason: error.message }); continue; }
        target.changed.add(dst.location.sheet);
        report.copied_fields[field] = (report.copied_fields[field] ?? 0) + 1;
      }
    }
    report.result = report.review.length || report.removed.length || old.missing.length ? "migrated with items to review" : "migrated";
    return true;
  }

  async function writeWorkbook(target) {
    const serialize = (doc) => new XMLSerializer().serializeToString(doc);
    const root = target.workbook.documentElement;
    let calc = child(root, "calcPr");
    if (!calc) {
      calc = element(root, "calcPr");
      const later = ["oleSize", "customWorkbookViews", "pivotCaches", "smartTagPr", "smartTagTypes", "webPublishing", "fileRecoveryPr", "webPublishObjects", "extLst"];
      root.insertBefore(calc, [...root.children].find((node) => later.includes(node.localName)) ?? null);
    }
    for (const [key, value] of Object.entries({ calcMode: "auto", fullCalcOnLoad: "1", forceFullCalc: "1" })) calc.setAttribute(key, value);
    target.zip.file("xl/workbook.xml", serialize(target.workbook), { createFolders: false });
    for (const [name, path] of target.paths) {
      const { doc } = target.docs.get(name) ?? await readXml(target.zip, path);
      let changed = target.changed.has(name);
      for (const f of doc.getElementsByTagNameNS(ns, "f")) {
        if (f.parentElement.localName !== "c") continue;
        for (const cached of children(f.parentElement, "v")) { cached.remove(); changed = true; }
      }
      if (changed) target.zip.file(path, serialize(doc), { createFolders: false });
    }
    return target.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  async function migrate(oldFile, newFile, baselineFile) {
    const report = { old_workbook: oldFile.name, new_workbook: newFile.name, output: "Community_Migrated.xlsx" };
    let errorContext = "old";
    try {
      const old = await loadWorkbook(oldFile);
      errorContext = "new";
      const target = await loadWorkbook(newFile);
      errorContext = "old_baseline";
      const baseline = baselineFile ? await loadWorkbook(baselineFile) : null;
      errorContext = "processing";
      if (!transfer(old, target, baseline, report)) return { report };
      return { report, workbook: await writeWorkbook(target) };
    } catch (error) {
      return { report: { ...report, result: "blocked: invalid or unsupported workbook", error: error.message, error_context: errorContext } };
    }
  }

  window.CommunityMigration = Object.freeze({ migrate });
})();
