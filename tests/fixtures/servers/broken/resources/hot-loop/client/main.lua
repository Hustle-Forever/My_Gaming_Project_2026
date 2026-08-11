CreateThread(function()
    while true do
        local vehicles = GetGamePool('CVehicle')
        checkAll(vehicles)
    end
end)

CreateThread(function()
    while true do
        Wait(0)
        DrawMarker(1, 0.0, 0.0, 0.0)
    end
end)
