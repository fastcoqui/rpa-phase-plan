# FY27 RPA Phase-plan Studio (unofficial)

**Live:** https://fastcoqui.github.io/rpa-phase-plan/

Unofficial MIRC FY27 RPA companion (Oct 2026 – Sep 2027) for 31 programs, grand PBG **$81,387,443**.

> **Disclaimer:** This is a local, in-browser what-if tool. Entries are saved only in your browser's localStorage and are never uploaded. The Excel workbook **FY27_RPA_Phase_Plan.xlsx** remains the working record.

## Features
- Fund / search / program filters; KPI strip (Authorized PBG, Annual plan, PBG−plan, Obligations, Plan−obligations, Obl/plan %)
- HQ / UNDISTRIBUTED / ALL blocks; Q1–Q4 / Annual views
- Program-level PBG on the MTH Plan rollup only — system rows (IPPS-A, DTS Travel, GFEBS) never carry their own PBG or DELTA
- Yellow (#FFF2CC) PM entry for monthly system phasing and monthly obligations; obligations feed HQ MTH Execution (UNDISTRIBUTED execution empty; ALL = HQ + UNDISTRIBUTED)
- MTH/CML Plan / Execution / Variance summary; DELTA = block PBG − plan
- Combo charts (selected program + filtered portfolio, monthly + cumulative): PBG straight-line area, phased-plan columns, obligations line with markers, delta and obligation % of plan
- Imbalance analysis and PM narrative prompts (>5% variance or obligation in a zero-plan month)
- JSON export/import and CSV export

## Local run
```bash
npm ci
npm run dev      # http://localhost:5173/rpa-phase-plan/
npm test && npm run build
```
Deployed by `.github/workflows/pages.yml` (GitHub Actions → Pages) on push to `main`.
