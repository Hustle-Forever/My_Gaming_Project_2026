# TASK_M2_SCANNER.md — The Server Scanner (read-only)

> **How to run:** In Claude Code:
> *"Read TASK_M2_SCANNER.md and complete all six milestones in order. Verify each ✅ before moving on. Follow the standing docs rule. Give me a full report at the end."*
>
> Unattended work — the human is asleep. Do not wait for input. Where a decision is needed, pick the option that best serves the goal, do it, and note it in the final report.

---

## 1. Why this exists

M2's next two products both depend on one capability that does not exist yet: **M2 must be able to read a customer's FiveM server and understand it.**

- The **AI Installer** (the client's request) cannot write a resource correctly until it knows which framework, inventory and job system that server runs.
- The **Doctor** (diagnosis product) is *entirely* this capability, surfaced as a report.

So this milestone is not a detour — it is the shared foundation. Build it read-only, which means it is safe: **this task must never write, modify, delete or move a single file on a customer's server.**

Everything here extends the existing M2 platform (Firebase + Vercel + tenant model + bridge). Do not fork a new project.

---

## 2. What it must produce

Given a connected FiveM server, M2 should be able to answer:

**Identity**
- Which framework: QBCore, ESX (and version/variant where detectable), or standalone
- Which inventory: ox_inventory, qb-inventory, qs-inventory, esx_inventoryhud, other
- Which core dependencies: oxmysql / mysql-async, ox_lib, PolyZone, etc.
- Which jobs exist and their grade structures (from framework config/shared files)
- Which items exist (from the inventory's item definitions)

**Inventory of the server**
- Every resource: name, whether started (`ensure`d), path, size, declared dependencies from `fxmanifest.lua`
- Load order from `server.cfg`
- Resources present on disk but never started (dead weight)
- Resources `ensure`d in cfg but missing on disk (broken references)

**Problems** — the diagnosis layer
- **Duplicates:** two or more resources providing the same function (two inventories, two job systems, two spawn managers, two anticheats)
- **Missing dependencies:** a manifest declares a dependency that is not present or not started
- **Load-order faults:** a resource started before a framework/dependency it requires
- **Structure faults:** double-nested folders (`resources/x/x/fxmanifest.lua`), missing `fxmanifest.lua`, malformed manifest
- **Lua syntax errors** in resource scripts
- **Risk signals:** obfuscated/escrowed code, suspicious outbound HTTP, `os.execute`/shell usage, hardcoded credentials in config files
- **Performance suspects:** tight loops with no `Wait`, `Wait(0)` in long-running threads, heavy per-frame work, oversized asset streams

**Health summary** — a plain-language verdict a non-technical owner understands, worst problems first, each with: what it is, why it matters, and what to do about it.

---

## 3. How it reads the server (build both paths)

The customer's file access is not yet known, so build an **adapter layer** — `lib/serverAccess/` — with one interface and three implementations. Everything above works identically regardless of which adapter is in use.

1. **`uploadAdapter`** *(build first — works for every customer, no access needed)*
   The owner uploads a ZIP of their `resources/` folder + `server.cfg` via the dashboard. M2 unpacks it in a temp workspace and scans. This alone makes the product sellable to anyone.
2. **`bridgeAdapter`** *(extends the existing Lua bridge)*
   Add **read-only** commands to the bridge: list resources, read a file, read the manifest, report started resources and performance counters. The bridge already polls outward, so no ports and no new infrastructure. **Read-only: no write/delete/move commands may exist in the bridge for this task.**
3. **`ftpAdapter`** *(stub + interface only)*
   Define the interface and leave a documented stub. Do not implement credential storage yet — that decision waits on the human.

Interface (roughly): `listFiles(path)`, `readFile(path)`, `stat(path)`, `exists(path)`. Nothing else. If an adapter cannot support a call, it fails clearly rather than guessing.

**Safety limits:** cap total bytes read, file count, and per-file size; skip binary assets (`.ytd`, `.yft`, `.ydr`, `.ymap`, streams) — read manifests, `.lua`, `.cfg`, `.json`, `.sql` only. Never follow symlinks outside the workspace. Time-box every scan.

---

## 4. Architecture

```
lib/serverAccess/     index.js (interface) · uploadAdapter.js · bridgeAdapter.js · ftpAdapter.js (stub)
lib/scanner/          index.js (orchestrator)
                      detectFramework.js · detectInventory.js · parseManifest.js
                      parseServerCfg.js · buildResourceGraph.js
                      checks/ (one file per check — duplicates, missingDeps, loadOrder,
                               structure, luaSyntax, riskSignals, performance)
                      report.js (structured findings → ranked, plain-language summary)
api/scan.js           POST — start a scan for the authenticated tenant
api/scan-status.js    GET — progress + result
```

**Rules:**
- Checks are **pluggable**: each exports `{ id, title, severity, run(serverModel) }` and returns findings. Adding a check must never require touching the orchestrator.
- Detection is **evidence-based, never guessed**. Every finding carries the evidence (file, line, resource) that produced it, and a confidence level. If the framework can't be determined, say "unknown" — do not assume QBCore.
- Findings are **translated**: every title, explanation and fix in **EN and AR**.
- Store scan results under `tenants/{uid}/scans/{scanId}` in Firestore. Store findings and the derived server model — **never** raw customer source code.
- Enforce the existing **pay-gate** and auth on all new endpoints, using the established error envelope and rate limits.

---

## 5. The dashboard UI

Add a **Server Report** section to `app/dashboard.html`, in the existing design system (tokens, orb, dark/light, EN/AR RTL, mobile-first at 380px):

- **Empty state** explaining what a scan does and that it is read-only and cannot change anything.
- **Start a scan:** upload ZIP, or "scan via bridge" when connected. Show progress.
- **Result view:**
  - A **health score** with a one-line verdict.
  - **Identity card:** framework, inventory, dependencies, job count, item count — with confidence shown.
  - **Findings list**, ranked by severity. Each expands to: what it is, why it matters, the evidence, and the recommended fix. Filter by severity.
  - **Resource table:** name, started/stopped, size, dependencies, issues.
  - **Export/share** the report (this is what an owner posts in their Discord — make it look good).
- **Scan history** with dates, so improvement over time is visible.

---

## 6. Milestones

1. **Access layer.** `lib/serverAccess/` interface + `uploadAdapter` (ZIP unpack, safety limits, temp workspace cleanup). ✅ a test ZIP unpacks and lists files; limits and cleanup proven by tests.
2. **Parse + model.** `parseManifest`, `parseServerCfg`, `buildResourceGraph` → a `serverModel` object. ✅ against fixtures.
3. **Detection.** Framework, inventory, dependencies, jobs, items — with evidence + confidence. ✅ correctly identifies QBCore and ESX fixtures, and returns "unknown" for an ambiguous one rather than guessing.
4. **Checks + report.** All checks in §2, plus `report.js` ranking and plain-language EN/AR output. ✅ a deliberately broken fixture surfaces every planted problem; a clean fixture reports clean (no false positives).
5. **API + bridge read commands.** `/api/scan`, `/api/scan-status`, Firestore storage, auth + pay-gate + rate limit; read-only bridge commands. ✅ end-to-end on the emulators; **a test asserts the bridge exposes no write capability**.
6. **Dashboard UI + docs.** The Server Report section; new `docs/SCANNER.md`; update `ENGINEERING.md`, `API.md`, `DATABASE.md`, `SECURITY.md`, `TESTING.md`, `FRONTEND.md`, `UIUX.md`; dated `DAILY_PROGRESS.md` entries; refresh `docs/index.html` stats/roadmap. ✅ full flow works in a browser at 380px, dark/light, EN/AR.

---

## 7. Test fixtures (build these — they make everything else provable)

Create `test/fixtures/servers/`:
- `qbcore-clean/` — healthy QBCore setup
- `esx-clean/` — healthy ESX setup
- `broken/` — deliberately contains: two inventories, a missing dependency, a load-order fault, a double-nested folder, a Lua syntax error, a `Wait(0)` busy loop, an `ensure` for a resource that isn't on disk
- `ambiguous/` — not clearly any framework (detection must return "unknown")

Extend `npm test` to cover the scanner. Keep the existing 48 tests green.

---

## 8. Rules

**DO** keep everything read-only; enforce auth + pay-gate on new endpoints; carry evidence and confidence on every finding; translate all user-facing text (EN/AR); keep checks pluggable; keep the existing design system; commit in logical chunks.

**DON'T** write, modify, delete or move anything on a customer's server; don't store raw customer source code; don't add FTP credential storage; don't guess a framework without evidence; don't weaken Firestore rules; don't push to GitHub (the human handles pushes).

**Final report:** what was built per milestone, `npm test` result, decisions made on the human's behalf, anything unverifiable, and exactly what is left for the human.
