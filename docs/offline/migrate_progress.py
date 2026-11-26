#!/usr/bin/env python3
"""Migrate Community Edition progress locally. Python 3.9+; standard library only."""
import argparse
import datetime
import json
import os
import posixpath
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from xml.dom import Node, minidom
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile
from xml.parsers.expat import ExpatError

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
SHEETS = ('Canon Release Checklist', 'Optional & Excluded', 'Documentaries & Extras')
PROJECT_SHEETS = ('Future Releases', 'Canceled & Reworked')
ID_HEADERS = {'permanent entry id', 'permanent optional id', 'permanent documentary id', 'permanent id'}
HEADERS = {
    'status': {'status', 'viewing status', 'reading status'},
    'rating': {'rating', 'rating (1–10)', 'rating (1-10)', 'personal rating (1–10)', 'personal rating (1-10)'},
    'completed_on': {'completed on', 'completed on (yyyy-mm-dd)', 'completion date'},
    'actual_minutes': {'actual minutes', 'actual time (min)', 'actual viewing minutes', 'actual reading minutes',
                       'actual viewing / reading minutes', 'actual viewing or reading minutes'},
    'personal_notes': {'personal notes', 'my notes', 'user notes'},
    'custom_access': {'my access link', 'custom access link', 'personal access link', 'user access link', 'user-customized access link'},
}
STATUSES = {x.lower(): x for x in ('Not Started', 'Completed', 'In Progress', 'On Hold')}
ADDRESS = re.compile(r'^([A-Z]+)([0-9]+)$')
ID_PATTERN = re.compile(r'^[A-Z][A-Z0-9]*-[0-9]+$')


def children(node, name):
    return [x for x in node.childNodes if x.nodeType == Node.ELEMENT_NODE and x.localName == name]


def child(node, name):
    return next(iter(children(node, name)), None)


def text(node):
    if node is None:
        return ''
    return ''.join(x.data if x.nodeType in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE)
                   else text(x) if x.nodeType == Node.ELEMENT_NODE else '' for x in node.childNodes)


def rich_text(node):
    return ''.join(text(x) if x.localName == 't' else text(child(x, 't'))
                   for x in node.childNodes if x.nodeType == Node.ELEMENT_NODE and x.localName in ('t', 'r'))


def make(parent, name):
    tag = f'{parent.prefix}:{name}' if parent.prefix else name
    return parent.ownerDocument.createElementNS(NS, tag)


def normal(s):
    return ' '.join(str(s or '').casefold().split())


def number(s):
    val = 0
    for char in s:
        val = val * 26 + ord(char) - 64
    return val


@dataclass(frozen=True)
class Value:
    kind: str
    data: str

    def blank(self):
        return self.data == '' and self.kind != 'formula'


@dataclass
class Entry:
    sheet: str
    row: object
    columns: dict
    values: dict
    title: str

    def location(self):
        return {'sheet': self.sheet, 'row': int(self.row.getAttribute('r')), 'title': self.title}

    def personal(self):
        return {f: v.data for f, v in self.values.items()
                if f in HEADERS and not v.blank() and not (f == 'status' and normal(v.data) == 'not started')}

    def unmatched(self):
        record = {**self.location(), 'personal_fields': self.personal()}
        if (link := self.values.get('legacy_access')) and not link.blank():
            record['prior_provider_link'] = link.data
        return record


class Workbook:
    def __init__(self, path):
        self.path = path
        self.archive = ZipFile(path)
        self.workbook = minidom.parseString(self.archive.read('xl/workbook.xml'))
        relationships = minidom.parseString(self.archive.read('xl/_rels/workbook.xml.rels'))
        targets = {x.getAttribute('Id'): x.getAttribute('Target') for x in children(relationships.documentElement, 'Relationship')}
        ss_xml = self.archive.read('xl/sharedStrings.xml') if 'xl/sharedStrings.xml' in self.archive.namelist() else None
        self.shared = [rich_text(x) for x in children(minidom.parseString(ss_xml).documentElement, 'si')] if ss_xml else []
        props = child(self.workbook.documentElement, 'workbookPr')
        self.date1904 = props is not None and props.getAttribute('date1904') in ('1', 'true')
        self.docs = {}
        self.paths = {}
        self.index = {}
        self.duplicates = {}
        self.missing = []
        self.legacy_project_sheets = []
        for tab in children(child(self.workbook.documentElement, 'sheets'), 'sheet'):
            name = tab.getAttribute('name')
            target = targets[tab.getAttributeNS(REL, 'id')]
            part = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
            self.paths[name] = part
            if name in SHEETS + PROJECT_SHEETS:
                self.read_inventory(name, part, optional=name in PROJECT_SHEETS)
        if not set(SHEETS) <= self.docs.keys():
            raise ValueError('Expected the Main, Optional & Excluded, and Documentaries & Extras inventory sheets.')

    def parse(self, c):
        t = c.getAttribute('t')
        raw = text(child(c, 'v'))
        if child(c, 'f') is not None:
            return Value('formula', '=' + text(child(c, 'f')))
        if t == 's':
            return Value('text', self.shared[int(raw)])
        if t == 'inlineStr':
            return Value('text', rich_text(child(c, 'is')))
        return Value({'str': 'text', 'd': 'date', 'e': 'error', 'b': 'boolean'}.get(t, 'number'), raw)

    def read_inventory(self, name, part, optional=False):
        doc = minidom.parseString(self.archive.read(part))
        self.docs[name] = doc
        rows = children(child(doc.documentElement, 'sheetData'), 'row')
        row1 = next(row for row in rows if row.getAttribute('r') == '1')
        labels = {ADDRESS.fullmatch(c.getAttribute('r'))[1]: normal(self.parse(c).data) for c in children(row1, 'c')}
        found = [col for col, label in labels.items() if label in ID_HEADERS]
        if optional and not found:
            self.legacy_project_sheets.append(name)
            return  # Earlier editions had no project IDs. Never guess by title.
        if len(found) != 1:
            raise ValueError(f'{name} must have exactly one permanent ID column.')
        id_col = found[0]
        fields = {}
        for field, names in HEADERS.items():
            matches = [c for c, label in labels.items() if label in names]
            if len(matches) > 1:
                raise ValueError(f'{name} has more than one column for {field}.')
            if matches:
                fields[field] = matches[0]
        # The Main provider field contains official metadata, even if an owner edited it.
        optional_legacy = {'watch or read link', 'public provider / store link',
                           'watch / read url (dashboard lookup)', 'watch / read url', 'watch or read url'}
        for c, label in labels.items():
            if label in optional_legacy and 'legacy_access' not in fields:
                fields['legacy_access'] = c
            if label in {'minutes (est.)', 'minutes (estimated)'}:
                fields['legacy_minutes'] = c
            if label in {'notes', 'content notes', 'runtime / access notes'}:
                fields['legacy_notes'] = c
        title_col = next((c for c, label in labels.items() if label in {'title / episode', 'title', 'project / original title'}), 'B')
        for row in rows:
            if row is row1:
                continue
            by_column = {ADDRESS.fullmatch(c.getAttribute('r'))[1]: c for c in children(row, 'c')}
            def v(col):
                return self.parse(by_column[col]) if col in by_column else Value('text', '')
            title = v(title_col).data
            pid_value = v(id_col)
            pid = pid_value.data.strip().upper()
            fields_here = {f: v(c) for f, c in fields.items()}
            entry = Entry(name, row, fields, fields_here, title)
            if not pid and not title and not entry.personal():
                continue
            if pid_value.kind != 'text' or not ID_PATTERN.fullmatch(pid):
                self.missing.append({'id': pid_value.data, **entry.unmatched()})
                continue
            if pid in self.index:
                self.duplicates.setdefault(pid, [self.index[pid].location()]).append(entry.location())
                continue
            self.index[pid] = entry

    def write(self, destination):
        props = child(self.workbook.documentElement, 'calcPr')
        if props is None:
            props = make(self.workbook.documentElement, 'calcPr')
            ext = child(self.workbook.documentElement, 'extLst')
            self.workbook.documentElement.insertBefore(props, ext)
        for key, val in {'calcMode': 'auto', 'fullCalcOnLoad': '1', 'forceFullCalc': '1'}.items():
            props.setAttribute(key, val)
        replacements = {'xl/workbook.xml': self.workbook.toxml(encoding='UTF-8')}
        for tab, part in self.paths.items():
            doc = self.docs.get(tab) or minidom.parseString(self.archive.read(part))
            # Stale XLSX caches can mask changes in some Calc configurations.
            for formula in doc.getElementsByTagNameNS(NS, 'f'):
                cell = formula.parentNode
                if cell.localName == 'c':
                    for node in children(cell, 'v'):
                        cell.removeChild(node)
            replacements[part] = doc.toxml(encoding='UTF-8')
        with ZipFile(destination, 'w', ZIP_DEFLATED) as out:
            for info in self.archive.infolist():
                out.writestr(info, replacements.get(info.filename) or self.archive.read(info.filename))


def put(entry, field, value):
    col = entry.columns[field]
    address = col + entry.row.getAttribute('r')
    cells = children(entry.row, 'c')
    c = next((x for x in cells if x.getAttribute('r') == address), None)
    if c is None:
        c = make(entry.row, 'c')
        c.setAttribute('r', address)
        following = next((x for x in cells if number(ADDRESS.fullmatch(x.getAttribute('r'))[1]) > number(col)), None)
        entry.row.insertBefore(c, following)
    if c.hasAttribute('t'):
        c.removeAttribute('t')
    for node in list(c.childNodes):
        if node.nodeType == Node.ELEMENT_NODE and node.localName in ('v', 'is', 'f'):
            c.removeChild(node)
    if value.kind == 'text':
        c.setAttribute('t', 'inlineStr')
        inline = make(c, 'is')
        t = make(inline, 't')
        t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
        t.appendChild(c.ownerDocument.createTextNode(value.data))
        inline.appendChild(t)
        c.appendChild(inline)
    else:
        if value.kind == 'date':
            c.setAttribute('t', 'd')
        v = make(c, 'v')
        v.appendChild(c.ownerDocument.createTextNode(value.data))
        c.appendChild(v)


def checked(field, value, old, new):
    if value.kind in ('formula', 'error', 'boolean'):
        raise ValueError('Only plain personal values can be imported.')
    if field == 'status':
        s = STATUSES.get(normal(value.data))
        if not s:
            raise ValueError('Unknown progress status.')
        return Value('text', s)
    if field in ('rating', 'actual_minutes'):
        import math
        n = float(value.data)
        if not math.isfinite(n) or not (1 <= n <= 10 if field == 'rating' else n >= 0):
            raise ValueError('Value is outside the supported range.')
        return Value('number', str(n))
    if field == 'completed_on':
        if value.kind == 'number':
            import math
            n = float(value.data)
            if not math.isfinite(n) or n < 0:
                raise ValueError('Invalid spreadsheet completion date.')
            if old.date1904 != new.date1904:
                if not old.date1904 and n <= 60:
                    raise ValueError('Early 1900 dates cannot be transferred between date systems.')
                n += 1462 if old.date1904 else -1462
                if n < 0:
                    raise ValueError('Date predates the target workbook date system.')
            return Value('number', str(n))
        day = value.data[:10] if value.kind == 'date' else value.data
        datetime.date.fromisoformat(day)
        return Value('text', day)
    if field == 'custom_access':
        from urllib.parse import urlsplit
        link = urlsplit(value.data)
        if link.scheme.lower() not in {'https', 'http'} or not link.hostname or link.username:
            raise ValueError('Custom links must be plain HTTP(S) URLs without embedded credentials.')
    return Value('text', value.data)


def save_atomic(path, write):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        partial = Path(tmp.name)
    try:
        write(partial)
        # Reserve the name first so an existing file is never replaced.
        with path.open('xb'):
            pass
        try:
            os.replace(partial, path)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
    finally:
        partial.unlink(missing_ok=True)


def migrate(old, new, baseline, output, report):
    report['duplicates'] = {'old': old.duplicates, 'new': new.duplicates}
    if baseline:
        report['duplicates']['old_baseline'] = baseline.duplicates
    report['missing_or_invalid_ids'] = {'old': old.missing, 'new': new.missing}
    unidentified = {'old': old.legacy_project_sheets, 'new': new.legacy_project_sheets}
    if any(unidentified.values()):
        report['project_sheets_without_ids'] = unidentified
    report['removed'] = [{'id': pid, **e.unmatched()}
                         for pid, e in old.index.items() if pid not in new.index]
    report['new_entries'] = [{'id': pid, **e.location()} for pid, e in new.index.items() if pid not in old.index]
    if any(report['duplicates'].values()) or new.missing:
        report['result'] = 'blocked: duplicate IDs or missing IDs in the target'
        return 2
    report['copied_fields'] = {}
    report['moved'] = []
    report['review'] = []
    contamination = [pid for pid, entry in new.index.items() if set(entry.personal()) - {'legacy_access'}]
    if contamination:
        report['result'] = 'blocked: target must be a fresh workbook with default progress'
        report['target_has_progress'] = contamination
        report['target_progress_entries'] = [{'id': pid, **new.index[pid].location()} for pid in contamination]
        return 2
    for pid, src in old.index.items():
        dst = new.index.get(pid)
        if dst is None:
            continue
        if src.sheet != dst.sheet:
            report['moved'].append({'id': pid, 'from': src.sheet, 'to': dst.sheet})
        values = dict(src.values)
        original = baseline.index.get(pid) if baseline else None
        for field, label in [('legacy_minutes', 'old planning minutes'), ('legacy_notes', 'old content notes')]:
            legacy_value = values.pop(field, Value('text', ''))
            if original and not legacy_value.blank() and legacy_value != original.values.get(field, Value('text', '')):
                report['review'].append({'id': pid, 'field': label, 'old_value': legacy_value.data, **dst.location(),
                                         'reason': 'Edited official metadata field. Review for personal data to save separately.'})
        custom = values.get('custom_access', Value('text', ''))
        legacy = values.pop('legacy_access', Value('text', ''))
        fresh_link = dst.values.get('legacy_access', Value('text', ''))
        if not legacy.blank() and legacy != fresh_link:
            prior_link = original.values.get('legacy_access', Value('text', '')) if original else None
            if prior_link is None or legacy != prior_link:
                if original and custom.blank():
                    values['custom_access'] = legacy
                else:
                    report['review'].append({'id': pid, 'field': 'old provider link', 'old_value': legacy.data,
                                              'new_official_link': fresh_link.data, **dst.location(),
                                              'reason': 'Older official link or user override. Review manually.' if not original else 'A dedicated personal link already exists.'})
        for field, v in values.items():
            if v.blank() or field == 'status' and normal(v.data) == 'not started':
                continue
            issue = {'id': pid, 'field': field, 'old_value': v.data, **dst.location()}
            if field not in dst.columns:
                report['review'].append({**issue, 'reason': 'The target sheet has no matching dedicated personal field.'})
                continue
            if field == 'custom_access' and not fresh_link.blank() and v != fresh_link:
                report['review'].append({**issue, 'reason': 'Kept the official provider link and copied the separate personal link if valid.', 'new_official_link': fresh_link.data})
            try:
                checked_value = checked(field, v, old, new)
            except ValueError as e:
                report['review'].append({**issue, 'reason': str(e)})
                continue
            put(dst, field, checked_value)
            report['copied_fields'][field] = report['copied_fields'].get(field, 0) + 1
    save_atomic(output, new.write)
    report['result'] = 'migrated with items to review' if report['review'] or report['removed'] or old.missing else 'migrated'
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('old', type=Path, help='Previous Community workbook with your progress')
    parser.add_argument('new', type=Path, help='Fresh Community workbook')
    parser.add_argument('--output', type=Path, default=Path('Community_Migrated.xlsx'))
    parser.add_argument('--report', type=Path, default=Path('Migration_Report.json'))
    parser.add_argument('--old-baseline', type=Path, help='Optional untouched copy of the old edition, for identifying provider link overrides')
    args = parser.parse_args()
    paths = [p.resolve() for p in [args.old, args.new, args.output, args.report] + ([args.old_baseline] if args.old_baseline else [])]
    if len(set(paths)) != len(paths) or args.output.exists() or args.report.exists():
        parser.error('Use distinct inputs and new paths for both output files.')
    if args.output.suffix.lower() != '.xlsx' or args.report.suffix.lower() != '.json':
        parser.error('Use an .xlsx output and a .json report.')
    if not args.output.parent.is_dir() or not args.report.parent.is_dir():
        parser.error('The output and report folders must exist.')
    report = {'old_workbook': args.old.name, 'new_workbook': args.new.name, 'output': args.output.name}
    try:
        old = Workbook(args.old)
        new = Workbook(args.new)
        baseline = Workbook(args.old_baseline) if args.old_baseline else None
        code = migrate(old, new, baseline, args.output, report)
    except (ValueError, OSError, KeyError, TypeError, IndexError, StopIteration, ImportError,
            RuntimeError, BadZipFile, ExpatError) as e:
        report.update({'result': 'blocked: invalid or unsupported workbook', 'error': str(e)})
        code = 2
    save_atomic(args.report, lambda path: path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'))
    print(f"{report['result']}. Report saved to {args.report}.")
    return code


if __name__ == '__main__':
    sys.exit(main())
