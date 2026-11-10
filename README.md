# FY27 RPA Phase-plan Studio (unofficial prototype)

**Published site:** https://fastcoqui.github.io/rpa-phase-plan/

Unofficial MIRC FY27 RPA companion (Oct 2026 – Sep 2027) for 31 programs. Authorized PBG is **$81,387,443**, counted once per program.

> This revision is a static browser prototype. Entries stay on the computer where they were typed until you export them. The Excel workbook **FY27_RPA_Phase_Plan.xlsx** remains the working record.

## What you can do

- The **Dashboard** opens first. It is the appropriation view for the programs chosen in **Programs**, all funds. The default is every program. Fund, search, and the selected program narrow the list and the drilldown only. Excluding a program leaves its phase plan and obligations in place, and that program can still be opened.
- Appropriation figures for the included programs: authorized PBG, full-year phased dollars, unphased balance (PBG − full-year phased), cumulative plan and obligations through a month you select, actual − plan (obligations − plan), execution % of cumulative plan, and execution % of full-year PBG. Each percentage names its denominator and time basis. A zero denominator is **N/A**. With no programs included, the totals are zero and those percentages are N/A.
- Monthly chart: phased-plan columns and an obligations line for each month, for the included programs. The figures under that chart are only the month selected in Cumulative through. A label on that month's column shows obligations, the percent of that month's plan obligated, and the dollars still needed to reach 95% of that month's plan (`0.95 × plan − obligations`). At or above 95% the label says **95% target met**. A zero plan shows **N/A** for the percent. The same required amount is repeated under the chart. Cumulative chart: dashed straight-line reference from the included programs' PBG, cumulative phased columns, and cumulative obligations. Its label uses cumulative plan and cumulative obligations through the selected month. The reference is not saved and does not fill the plan. The label follows the Programs include/exclude filter, and the program drilldown has its own label.
- A program drilldown stays on the dashboard and follows the Program selector, including a program left out of the appropriation totals. Phase plan, obligations, and imbalance stay available.
- Quarter highlight sits with the phase plan (Q1, Q2, Q3, Q4, or Annual). It shades that quarter's month columns and quarter total. It is display only and is not saved.
- Each program has **one** yellow monthly plan row for Oct 2026–Sep 2027. Programs that use both IPPS-A and DTS Travel are phased on that single row. Single-system programs stay one row. There is no HQ / Undistributed / All block switch.
- Monthly execution, monthly variance (plan − execution), cumulative plan / execution / variance, and quarter and annual totals stay on the phase plan. PBG and PBG − plan sit on the plan row.
- Obligations are one row per program. That row is the program's execution. An optional system memo can note an IPPS-A / DTS split; the memo is not added to execution.
- PM templates start blank. The straight-line percentages (8 / 17 / 25 … 100) are a comparison row and the cumulative chart reference only.
- **Status of Funds** follows the RPA Status of Funds layout. PLAN on a matched row is the phase plan cumulative through the as-of month. PBG is the program's authorized PBG. Obligations and commitments on that tab are cumulative fiscal-year-to-date. Import an `.xlsx` or `.csv` in that template shape, paste rows, or type them. **Preview apply to obligations** shows, for each matched program, the cumulative SOF, the total already recorded in earlier FY27 months, and the derived amount for the as-of month (`cumulative − prior months`). A negative derived amount is flagged `cumulative decreased — check de-obligation`. **Confirm apply to obligations** writes that month's figure into the phase-plan execution row, which the dashboard and the 95% labels then use. A later report for the same month replaces that month. An earlier month's snapshot stays stored and later snapshots are re-derived from it. Rows that do not match a program by MDEP and suffix stay on the tab, flagged Unmatched, and are not written into obligations. Export writes the tab back to `.xlsx`. Percent of obligation vs plan is green from 95% through 105%, amber from 90% up to 95% or over 105% through 110%, and red under 90% or over 110%. Over-execution is flagged as well as a shortfall. A zero plan stays N/A. The 95% / 100% / 105% footer uses BASE TOTAL plan and BASE TOTAL obligations. The 105% line is marked do not exceed.

## Where entries are stored

Published site and this prototype both keep entries in the **browser**. They do not upload them. There is no account and no shared database. IndexedDB is not used.

### Published site (the build currently on GitHub Pages)

The live page is the static build of `main` from before this revision. On startup it reads `localStorage` key `fy27-rpa-studio-v1` into an in-memory object. It writes that key back with `localStorage.setItem` when a yellow cell fires a **change** event (when you leave the field). There is no Save button. Export JSON downloads that object. Import JSON replaces it. Export CSV does not load back. UI choices (fund, search, selected program, tab) are not stored. The only `fetch` in that published bundle is the page loader, not a data store.

`localStorage` belongs to this origin, this device, and this browser profile. Entries typed on one computer are absent on another. That is why a second computer shows an empty plan.

**To move entries off the published site:** on the computer that has them, choose **Export JSON** and keep the file. On the other computer, choose **Import**. Do that before clearing site data. The file contains the amounts you typed; the app does not send it anywhere.

### This prototype

Calculations and migration live in `src/model.js` and do not read or write storage. `src/storage.js` is the only persistence adapter. It reads `fy27-rpa-studio-v1` once, writes `fy27-rpa-studio-v2`, and does not delete the old key.

- Working copy: in memory while the tab is open.
- Saved copy: `localStorage` key `fy27-rpa-studio-v2` on this device and browser profile. The save may include `dashboardIncluded`, the appropriation program selection. If that field is absent, every program is included. It does not replace plan or obligation amounts. It may also include an optional `sof` object (as-of date, working rows, and per-month cumulative snapshots). If `sof` is absent, no Status of Funds report has been stored. Reset clears the active plan, obligations, and `sof`, keeps a migration backup, and keeps the program selection.
- Autosave: as you type, and again when the tab is hidden or closed. Totals and charts refresh when you leave a cell.
- Import accepts a JSON export from the published site or from this revision. Import **replaces** what is stored in the browser where you import it. Export the current browser first if you need to keep it.
- Export JSON keeps entered values and any migration backup. Export CSV is rounded to the dollar and cannot be imported.
- Clearing site data for this origin, or closing a private window that discards data, removes the local copy. Some browsers also clear site data that has not been used for a long time. The JSON file is the copy you hold.
- The browser's localStorage quota for this origin is far larger than this phase plan. The limit that matters is that the saved copy is tied to one browser profile.

### Undistributed and split system rows

Older saves and exports stored a plan per system, and a separate Undistributed block. This revision sums IPPS-A and DTS Travel (and any other system rows) into the one program plan for each month. It skips rollup keys such as ALL so a stored total is not added again. Undistributed plan dollars and Undistributed PBG tags are **not** added to the active plan or to PBG. Authorized PBG stays the original program amount. When those excluded amounts are non-zero, the page says so. They remain in the migration backup inside Export JSON, in **Download migration backup**, and in the untouched `fy27-rpa-studio-v1` key on this browser. To phase any of that old Undistributed plan, type it on the single program row. Reset clears the active plan and obligations and keeps the backup.

## Deployment assumptions

GitHub Pages (or any static file host) serves this prototype. This revision does not add a server, an account, or a shared store.

Packaging for an authorized host, including Army Vantage, is a later step. This prototype does not connect to Army Vantage and does not claim Army Vantage compatibility. It does not connect to commercial products named Vantage. Shared storage and authentication wait until the design is approved and that host's deployment capabilities have been verified. Export and migration stay in the file formats above so a later package can read them without this prototype growing a second store.

## Local run

```bash
npm ci
npm run dev      # http://localhost:5173/rpa-phase-plan/
npm test && npm run build
```

`.github/workflows/pages.yml` publishes GitHub Pages on push to `main`. A pull request does not deploy.
