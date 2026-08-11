# Server Scanner

**Area:** Read-only FiveM server analysis — the shared foundation for the Doctor and the AI Installer · **Last updated:** 2026-08-12

> Given a customer's FiveM server, M2 reads it and understands it: what framework/inventory/jobs it runs, every resource and the real load order, and a ranked list of problems in plain language. **Strictly read-only** — it never writes, moves, or deletes anything, by construction. The Doctor product *is* this report; the AI Installer will consume the same `serverModel`.

---

## Pipeline

```
access adapter ──► parseServerCfg ──► buildResourceGraph ──► detect(framework,   ──► checks[] ──► report
(read-only text)   (ensure order,      (serverModel:            inventory, deps,      (pluggable)   (ranked,
                    exec recursion)     resources+structure)     jobs, items)                        EN/AR)
```

Orchestrator: [`lib/scanner/index.js`](../lib/scanner/index.js). `scan(adapter) → report`. Adding a check never touches the orchestrator.

## Access layer (`lib/serverAccess/`)

One read-only adapter contract — `listFiles(prefix?)`, `readFile(path)`, `stat(path)`, `exists(path)`, `destroy()` — with four sources:

| adapter | source | status |
|---|---|---|
| `fromZipBuffer` | uploaded ZIP (in-memory, no temp files) | built |
| `fromScanPack` | client-built `{files:[{path,content,size}]}` (dashboard folder picker) | built — the live path |
| `fromDirectory` | local dir (fixtures, tests) | built |
| `fromBridgePayload` | files collected via the bridge's read-only `scan_*` commands | built (payload → scan-pack) |
| `ftpAdapter` | FTP/SFTP pull | **documented stub** — credential storage is a pending human decision |

**Safety, proven by tests:** entry-count / per-file / total-byte caps; **only text is ever readable** (`.lua/.cfg/.json/.sql/.txt/.md` + manifests) — binary assets (`.ytd/.yft/.ydr/.ymap/streams`) are listed by name+size but their content is never loaded; path-traversal entries are dropped and recorded; symlinks are skipped; `destroy()` frees the workspace.

## What it detects (evidence + confidence, never a guess)

- **Framework** — QBCore/QBox, ESX (with version), else **unknown** (never assumed). Signals: marker resources + `exports[...]` usage.
- **Inventory** — winner + all candidates (multiple started inventories is a real, flagged misconfig).
- **Dependencies** — oxmysql/mysql-async, ox_lib, PolyZone, targets, pma-voice…
- **Jobs** — parsed from `qb-core/shared/jobs.lua` with grade counts (ESX jobs are often DB-driven → noted).
- **Items** — counted from `ox_inventory/data/items.lua` or `qb-core/shared/items.lua`.

Every detection carries `{ evidence:[{file,detail,...}], confidence }`.

## Checks (`lib/scanner/checks/`, pluggable)

Each exports `{ id, title, severity, run(model, ctx) → findings[] }`. A finding is `{ checkId, severity, title:{en,ar}, why:{en,ar}, fix:{en,ar}, evidence:[{resource?,file?,line?,detail}] }`.

| check | finds |
|---|---|
| `duplicates` | two started systems in one role (inventory/target/spawn/anticheat/hud) |
| `missingDeps` | manifest dependency absent, or present-but-not-started |
| `loadOrder` | a resource ensured before a dependency it needs |
| `structure` | double-nested folders, dirs with no manifest, ghost resources (ensured, absent), malformed manifests |
| `luaSyntax` | unbalanced block keywords (comment/string-stripped; best-effort, no Lua VM) |
| `riskSignals` | `os.execute`/shell, suspicious outbound HTTP, hardcoded secrets, obfuscated blobs, escrow marker |
| `performance` | `while true` with no `Wait`, `Wait(0)` hot loops, oversized stream folders |
| `deadWeight` | resources on disk never started |

`report.js` ranks findings worst-first, computes a weighted 0–100 health score, and writes a plain-language EN/AR verdict.

## API

- **`POST /api/scan`** — verified-auth + pay-gate + per-tenant rate limit (`SCAN_RATE_LIMIT_PER_HOUR`, default 20/h). Body `{ source:'upload', pack:{files:[…]} }`. Runs the scan and returns `{ ok, scanId, status:'complete', health, identity, findingCount }`.
- **`GET /api/scan-status?scanId=…`** — full stored report; without `scanId`, the tenant's scan history (summaries). Same auth/gate.

Full contract in [API.md](API.md).

## Storage & privacy

Scans live at `tenants/{uid}/scans/{scanId}` — **the derived report only**: identity, findings, and a structural `serverModel` (resource names, sizes, deps, order, structure flags). **Raw customer source code and secrets are never stored.** Two layers guarantee it: findings carry *locations* (resource/file/line) not verbatim source, and a storage-time sanitizer (`report.js`) redacts any secret-shaped or over-long evidence detail. Tests assert `os.execute`/secret strings never appear in the stored document or the rendered report.

## The bridge path (read-only)

`fivem-bridge/scan.lua` adds `scan_list_resources`, `scan_read_file`, `scan_read_manifest`, `scan_perf`. It reads via `LoadResourceFile` (FiveM's read-only accessor) and resource-state getters — **no `SaveResourceFile`, `io.write`, `os.remove/rename/execute`, `io.popen`**. A test (`tests/scanner-api.test.js`) statically asserts the entire `fivem-bridge/` directory contains none of those write primitives. Collected files become a scan-pack and flow through the same scanner.

## Dashboard

`app/dashboard.html` → **Server Report** card: read-only banner, folder picker (builds a text-only scan-pack in the browser — binaries never leave the machine), progress, and a result view — conic **health gauge** + verdict + severity counts, an **identity card** with confidence, **filterable expandable findings** (why / how-to-fix / where), a **resource table**, **export to text** (the Discord-shareable report), and **scan history**. Full design-system parity, EN/AR RTL, dark/light, 380px-first.

## Tests

`tests/scanner-access|model|detect|checks|api|ui.test.js` — 40 tests: safety limits & traversal, parsers vs fixtures, detection incl. the ambiguous→unknown case, the broken fixture surfacing all planted faults while clean fixtures stay clean, the API (auth/verify/gate/rate/storage/no-raw-source), the bridge read-only assertion, and a jsdom render of the actual dashboard code (EN/AR/filters/no-leak). Fixtures: `tests/fixtures/servers/{qbcore-clean,esx-clean,broken,ambiguous}`. See [TESTING.md](TESTING.md).
