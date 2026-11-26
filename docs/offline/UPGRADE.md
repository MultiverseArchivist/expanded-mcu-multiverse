# Keep your progress when you upgrade

The upgrader runs on your computer with **Python 3.9 or newer** and its standard library. Windows, macOS, and Linux are supported by the utility’s file and XML operations. The release was validated in LibreOffice Calc. The maintainer opened and recalculated a browser-migrated workbook in desktop Microsoft Excel. Support across all Excel features and versions remains unverified. No workbook macros, external workbook links, dependencies to install with pip, or uploads are required.

1. Save and close your current Community workbook. Keep this copy as a backup.
2. Download and extract the new release. Use its fresh workbook as the target. The upgrader stops if the target already has personal progress.
3. Put the old workbook, new workbook, and the included script in one folder. Open Terminal or PowerShell in that folder. Substitute your actual file names for the examples.

On Windows:

```powershell
py -3 migrate_progress.py "Old Community.xlsx" "New Community.xlsx" --output "Upgraded Community.xlsx" --report "My Migration Report.json"
```

On macOS or Linux:

```sh
python3 migrate_progress.py "Old Community.xlsx" "New Community.xlsx" --output "Upgraded Community.xlsx" --report "My Migration Report.json"
```

4. Open the report in a text editor. Check **review**, **removed**, and **missing_or_invalid_ids**. Duplicate IDs stop the migration and the report lists every duplicate location so you can correct a separate copy.
5. Open the upgraded workbook in Calc and check Dashboard and some recent entries before replacing your day-to-day copy. Open, recalculate if prompted, and save to refresh workbook displays.

## Project IDs across releases

A Future or Canceled project that already has a permanent ID can be matched after it moves into another inventory, including a release checklist. The new edition supplies its title, release date, classification and runtime. When an older workbook has no project IDs on those sheets, the report flags that fact and the upgrader skips those project rows. If you edited them, review your copy manually.

## What transfers

The upgrader automatically transfers **status, ratings, and completion dates** for matching permanent content IDs, even if entries changed titles, dates, positions, or worksheets. New entries start with the new release’s default status and blank dates and ratings.

Column J contains **official planning estimates**. The upgrade uses the new edition’s estimates. Any edits you made to J stay in the old workbook. Keep a separate record of your actual viewing or reading times, personal notes, and customized links. The v3.0.0 workbook has no dedicated fields for these.

Optional and Documentary **Source / access reference** cells are official reference fields. The upgrader neither copies nor reports your edits to those cells, so review your old copy if you customized them. Changes in the old Main provider-link column can appear in the report for review. If you have an untouched older edition, add `--old-baseline "Untouched Old Community.xlsx"` to help identify edits to Main provider links, planning minutes, and official notes. The new workbook keeps its official metadata, formulas, and styling.

The migration report can contain personal notes, times, links, and dates. Keep it private. Choose a new filename for each output when repeating a migration.

The new workbook retains the opening positions from the target workbook.
