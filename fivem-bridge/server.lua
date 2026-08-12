-- server.lua - polls the backend (OUTBOUND HTTP only - the backend never
-- connects in, so no ports to open), dispatches whitelisted actions to named
-- handlers, then acks the command ids. Unknown actions are logged and
-- skipped - nothing is ever executed generically.

local TAG = '[ai-roleplay-bridge]'

-- Demo targeting: player-facing actions go to the first connected player;
-- world state (weather / time) is broadcast to everyone. See README.
local function firstPlayer()
    local players = GetPlayers()
    return players[1] and tonumber(players[1]) or nil
end

local Handlers = {}

function Handlers.spawn_vehicle(params)
    local target = firstPlayer()
    if not target then return false, 'no players online' end
    TriggerClientEvent('airp:spawnVehicle', target, params.model)
    return true
end

function Handlers.set_weather(params)
    TriggerClientEvent('airp:setWeather', -1, params.type)
    return true
end

function Handlers.set_time(params)
    TriggerClientEvent('airp:setTime', -1, params.hour)
    return true
end

function Handlers.heal_player(_)
    local target = firstPlayer()
    if not target then return false, 'no players online' end
    TriggerClientEvent('airp:healPlayer', target)
    return true
end

function Handlers.spawn_npc(params)
    local target = firstPlayer()
    if not target then return false, 'no players online' end
    TriggerClientEvent('airp:spawnNpc', target, params.count or 1)
    return true
end

function Handlers.repair_vehicle(_)
    local target = firstPlayer()
    if not target then return false, 'no players online' end
    TriggerClientEvent('airp:repairVehicle', target)
    return true
end

local function ackCommands(ids)
    if #ids == 0 then return end
    PerformHttpRequest(Config.BackendUrl .. '/api/bridge/ack', function(status)
        if status ~= 200 then
            print(('%s ack failed: HTTP %s'):format(TAG, tostring(status)))
        end
    end, 'POST', json.encode({ ids = ids }), {
        ['Content-Type'] = 'application/json',
        ['x-bridge-token'] = Config.BridgeToken,
    })
end

local function handleCommands(commands)
    local handledIds = {}
    for _, cmd in ipairs(commands) do
        local handler = Handlers[cmd.action]
        if handler then
            local ok, err = handler(cmd.params or {})
            if ok then
                print(('%s executed %s %s'):format(TAG, cmd.id, cmd.action))
            else
                print(('%s skipped %s %s: %s'):format(TAG, cmd.id, cmd.action, err or 'handler failed'))
            end
        else
            print(('%s UNKNOWN action %s (%s) - logged and skipped'):format(TAG, tostring(cmd.action), cmd.id))
        end
        -- ack skipped commands too, so they never loop forever
        handledIds[#handledIds + 1] = cmd.id
    end
    ackCommands(handledIds)
end

local function pollOnce()
    PerformHttpRequest(Config.BackendUrl .. '/api/bridge/poll', function(status, body)
        if status == 401 then
            print(TAG .. ' poll rejected: invalid bridge token (check airp_bridge_token)')
            return
        end
        if status == 402 then
            print(TAG .. ' poll rejected: subscription inactive (renew your M2 plan)')
            return
        end
        if status ~= 200 then
            print(('%s poll failed: HTTP %s'):format(TAG, tostring(status)))
            return
        end
        local ok, data = pcall(json.decode, body or '')
        if not ok or type(data) ~= 'table' or type(data.commands) ~= 'table' then
            print(TAG .. ' poll returned invalid JSON')
            return
        end
        if #data.commands > 0 then
            handleCommands(data.commands)
        end
    end, 'GET', '', { ['x-bridge-token'] = Config.BridgeToken })
end

CreateThread(function()
    if Config.BackendUrl == '' or Config.BridgeToken == '' then
        print(TAG .. ' NOT STARTED: set the airp_backend_url and airp_bridge_token convars in server.cfg')
        return
    end
    print(('%s polling %s/api/bridge/poll every %dms'):format(TAG, Config.BackendUrl, Config.PollIntervalMs))
    while true do
        pollOnce()
        Wait(Config.PollIntervalMs)
    end
end)
