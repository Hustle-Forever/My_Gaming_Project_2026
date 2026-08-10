fx_version 'cerulean'
game 'gta5'
lua54 'yes'

author 'FiveM AI Roleplay Control'
description 'Bridge resource: polls the AI backend (outbound HTTP only) for whitelisted roleplay commands and executes them in-game'
version '0.1.0'

server_scripts {
    'config.lua',
    'server.lua',
}

client_scripts {
    'client.lua',
}
