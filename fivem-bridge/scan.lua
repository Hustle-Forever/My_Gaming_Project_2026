-- scan.lua - READ-ONLY server introspection for the M2 Scanner.
--
-- SAFETY CONTRACT (enforced by tests/scanner-api.test.js):
--   * This file uses ONLY read APIs. It never writes, moves, or deletes.
--   * File reads go through LoadResourceFile (FiveM's read-only accessor).
--   * SaveResourceFile / io.write / io.open(write) / os.remove / os.rename /
--     os.execute / io.popen MUST NEVER appear here. A test greps for them.
--
-- The bridge already polls /api/bridge/poll for commands. Scan requests arrive
-- as ordinary queued commands (action = "scan_*"); results are posted back to
-- /api/bridge/scan-result. No inbound ports, no new infrastructure.

local TAG = '[m2-scanner]'

-- List every resource and its started/stopped state (read-only).
local function listResources()
    local out = {}
    local n = GetNumResources()
    for i = 0, n - 1 do
        local name = GetResourceByFindIndex(i)
        if name then
            out[#out + 1] = {
                name = name,
                state = GetResourceState(name),           -- 'started' / 'stopped' / ...
                path = GetResourcePath(name),             -- read-only path lookup
                version = GetResourceMetadata(name, 'version', 0),
            }
        end
    end
    return out
end

-- Read a single text file from within a resource (read-only). Path is confined
-- to the resource by LoadResourceFile itself - it cannot escape the resource.
local function readResourceFile(resource, file)
    if type(resource) ~= 'string' or type(file) ~= 'string' then return nil end
    -- refuse obvious traversal and non-text just in case
    if file:find('%.%.') then return nil end
    return LoadResourceFile(resource, file)  -- returns nil if absent; never writes
end

-- Lightweight performance counters (read-only telemetry).
local function perfCounters()
    local players = GetNumPlayerIndices and GetNumPlayerIndices() or #GetPlayers()
    return {
        players = players,
        resources = GetNumResources(),
        uptimeMs = GetGameTimer(),
    }
end

-- Dispatch table for scan_* actions. Every entry is read-only.
M2ScanHandlers = {
    scan_list_resources = function()
        return { resources = listResources() }
    end,
    scan_read_file = function(params)
        return { content = readResourceFile(params.resource, params.file) }
    end,
    scan_read_manifest = function(params)
        return {
            manifest = readResourceFile(params.resource, 'fxmanifest.lua')
                or readResourceFile(params.resource, '__resource.lua'),
        }
    end,
    scan_perf = function()
        return perfCounters()
    end,
}

print(TAG .. ' read-only scan handlers registered (no write/delete/move capability)')
