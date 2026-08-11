local count = 0
RegisterNetEvent('bad:sync', function()
    if count > 10 then
        print('too many')
    count = count + 1
end)
