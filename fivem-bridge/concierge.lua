-- concierge.lua - the M2 Concierge bridge. NOTIFY-ONLY by construction.
--
-- SAFETY CONTRACT (enforced by tests/concierge-bridge.test.js):
--   * It ONLY sends chat messages to a player, opens a menu, and sets a
--     waypoint on the player's own map. That's it.
--   * It NEVER spawns, teleports, gives money/items, changes jobs, kicks,
--     bans, or writes files. Those FiveM natives (SetEntityCoords, CreateVehicle,
--     CreatePed, GiveMoney/AddItem, DropPlayer, SaveResourceFile, ...) MUST NOT
--     appear in this file. A test greps for them.
--   * Outbound HTTP only (the existing poll/ack pattern). No inbound ports.

local TAG = '[m2-concierge]'
local seen = {}   -- players we've already reported a join for this session

-- Post an event to M2 and hand any returned actions to the player.
local function postEvent(payload, cb)
    PerformHttpRequest(Config.BackendUrl .. '/api/concierge/event', function(status, body)
        if status ~= 200 then
            if status ~= 401 and status ~= 402 then
                print(('%s event failed: HTTP %s'):format(TAG, tostring(status)))
            end
            if cb then cb(nil) end
            return
        end
        local ok, data = pcall(json.decode, body or '')
        if ok and type(data) == 'table' and cb then cb(data) end
    end, 'POST', json.encode(payload), {
        ['Content-Type'] = 'application/json',
        ['x-bridge-token'] = Config.BridgeToken,
    })
end

-- Apply the closed set of actions to one player (the ONLY things we can do).
local function applyActions(playerId, actions)
    if type(actions) ~= 'table' then return end
    for _, a in ipairs(actions) do
        if a.type == 'send_message' and a.text then
            -- send a chat line to just this player
            TriggerClientEvent('chat:addMessage', playerId, { color = { 120, 200, 120 }, args = { 'Concierge', a.text } })
        elseif a.type == 'show_menu' and a.items then
            -- hand the menu to the client to render (client-side only)
            TriggerClientEvent('m2c:menu', playerId, { title = a.title, items = a.items })
        elseif a.type == 'set_waypoint' then
            -- ask the client to drop a waypoint on their OWN map
            TriggerClientEvent('m2c:waypoint', playerId, { x = a.x, y = a.y, label = a.label })
        end
        -- any other action type is ignored (defence in depth; the server
        -- already only ever sends these three).
    end
end

-- Detect a first join and greet.
AddEventHandler('playerJoining', function()
    local src = source
    if seen[src] then return end
    seen[src] = true
    local name = GetPlayerName(src) or 'player'
    postEvent({ type = 'join', playerId = tostring(src), playerName = name }, function(data)
        if data and data.onboard and data.actions then applyActions(src, data.actions) end
    end)
end)

AddEventHandler('playerDropped', function()
    seen[source] = nil
end)

-- Relay a menu choice or a chat message from the client.
RegisterNetEvent('m2c:choose', function(jobId)
    postEvent({ type = 'choice', playerId = tostring(source), jobId = jobId }, function(data)
        if data and data.actions then applyActions(source, data.actions) end
    end)
end)

RegisterNetEvent('m2c:dismiss', function()
    postEvent({ type = 'dismiss', playerId = tostring(source) }, function() end)
end)

-- The client can forward a typed question (theme only is stored server-side).
RegisterNetEvent('m2c:message', function(text)
    postEvent({ type = 'message', playerId = tostring(source), text = tostring(text or '') }, function(data)
        if data and data.actions then applyActions(source, data.actions) end
    end)
end)

-- Poll for time-triggered actions (the ~5-minute check-in) for online players.
CreateThread(function()
    if Config.BackendUrl == '' or Config.BridgeToken == '' then return end
    while true do
        Wait(30000)
        for _, src in ipairs(GetPlayers()) do
            PerformHttpRequest(Config.BackendUrl .. '/api/concierge/reply', function(status, body)
                if status ~= 200 then return end
                local ok, data = pcall(json.decode, body or '')
                if ok and data and data.actions then applyActions(tonumber(src), data.actions) end
            end, 'POST', json.encode({ playerId = tostring(src) }), {
                ['Content-Type'] = 'application/json',
                ['x-bridge-token'] = Config.BridgeToken,
            })
        end
    end
end)

print(TAG .. ' notify-only concierge loaded (message / menu / waypoint only)')
