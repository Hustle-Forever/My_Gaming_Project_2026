-- client.lua - the real natives, one small named handler per whitelisted
-- action. These run on the player the server targeted.

local TAG = '[ai-roleplay-bridge]'

local WEATHER_MAP = {
    clear = 'CLEAR',
    rain = 'RAIN',
    thunder = 'THUNDER',
    fog = 'FOGGY',
    snow = 'XMAS',
}

local NPC_MODELS = {
    'a_m_m_business_01',
    'a_f_y_tourist_01',
    'a_m_y_skater_01',
    'a_f_m_bevhills_01',
    'a_m_m_farmer_01',
}

local function loadModel(hash)
    RequestModel(hash)
    local deadline = GetGameTimer() + 10000
    while not HasModelLoaded(hash) do
        if GetGameTimer() > deadline then return false end
        Wait(50)
    end
    return true
end

RegisterNetEvent('airp:spawnVehicle', function(model)
    local hash = joaat(model)
    if not IsModelInCdimage(hash) or not IsModelAVehicle(hash) then
        print(('%s invalid vehicle model: %s'):format(TAG, tostring(model)))
        return
    end
    if not loadModel(hash) then
        print(('%s model %s failed to load'):format(TAG, tostring(model)))
        return
    end
    local ped = PlayerPedId()
    local coords = GetEntityCoords(ped)
    local heading = GetEntityHeading(ped)
    local vehicle = CreateVehicle(hash, coords.x + 2.5, coords.y, coords.z + 0.5, heading, true, false)
    SetVehicleOnGroundProperly(vehicle)
    SetPedIntoVehicle(ped, vehicle, -1)
    SetModelAsNoLongerNeeded(hash)
end)

RegisterNetEvent('airp:setWeather', function(weatherType)
    local weather = WEATHER_MAP[weatherType]
    if not weather then
        print(('%s unknown weather type: %s'):format(TAG, tostring(weatherType)))
        return
    end
    SetWeatherTypeOverTime(weather, 5.0)
    Wait(5000)
    SetWeatherTypeNowPersist(weather)
end)

RegisterNetEvent('airp:setTime', function(hour)
    local h = tonumber(hour)
    if not h or h < 0 or h > 23 then return end
    NetworkOverrideClockTime(math.floor(h), 0, 0)
end)

RegisterNetEvent('airp:healPlayer', function()
    local ped = PlayerPedId()
    SetEntityHealth(ped, GetEntityMaxHealth(ped))
    SetPedArmour(ped, 100)
    ClearPedBloodDamage(ped)
end)

RegisterNetEvent('airp:spawnNpc', function(count)
    local n = math.min(5, math.max(1, math.floor(tonumber(count) or 1)))
    local ped = PlayerPedId()
    local coords = GetEntityCoords(ped)
    for i = 1, n do
        local model = NPC_MODELS[((i - 1) % #NPC_MODELS) + 1]
        local hash = joaat(model)
        if loadModel(hash) then
            local angle = (i / n) * 2 * math.pi
            local x = coords.x + math.cos(angle) * 2.5
            local y = coords.y + math.sin(angle) * 2.5
            local npc = CreatePed(4, hash, x, y, coords.z, 0.0, true, true)
            SetBlockingOfNonTemporaryEvents(npc, true) -- friendly/neutral: don't flee or attack
            SetPedAsNoLongerNeeded(npc)
            SetModelAsNoLongerNeeded(hash)
        end
    end
end)

RegisterNetEvent('airp:repairVehicle', function()
    local ped = PlayerPedId()
    local vehicle = GetVehiclePedIsIn(ped, false)
    if vehicle == 0 then
        print(TAG .. ' repair_vehicle: player is not in a vehicle')
        return
    end
    SetVehicleFixed(vehicle)
    SetVehicleDeformationFixed(vehicle)
    SetVehicleDirtLevel(vehicle, 0.0)
    SetVehicleEngineHealth(vehicle, 1000.0)
    SetVehiclePetrolTankHealth(vehicle, 1000.0)
end)
