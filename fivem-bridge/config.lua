-- config.lua - all values come from server convars. NOTHING is hardcoded here.
--
-- Add these to your server.cfg (see README for details):
--   set airp_backend_url "https://your-backend.example.com"   # no trailing slash
--   set airp_bridge_token "the-tenant-bridge-token"           # matches DEMO_BRIDGE_TOKEN on the backend
--   set airp_poll_interval_ms 1500                            # optional, default 1500

Config = {}
Config.BackendUrl = GetConvar('airp_backend_url', '')
Config.BridgeToken = GetConvar('airp_bridge_token', '')
Config.PollIntervalMs = tonumber(GetConvar('airp_poll_interval_ms', '1500')) or 1500
