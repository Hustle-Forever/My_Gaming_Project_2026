# TASK_M2_CONCIERGE.md — The Concierge
(full spec saved verbatim in the conversation; see below for the working summary)

The Concierge: an in-game AI that catches a new player's first spawn and gives them a
reason to stay — greets by name, asks what character they want, points at something to
do, sets a waypoint, introduces a nearby real player, checks in at ~5 min. EN/AR. Attacks
the retention "leak" that kills empty servers. Built on the M2 platform, reusing the
scanner's serverModel so it recommends jobs/locations the server actually has.

Closed action set: send-message-to-one-player, set-waypoint, show-menu ONLY. Never
spawn/teleport/give/modify. Cheapest model, hard token+message caps, deterministic
fallback with no key. Player data minimised (no long-term raw chat), purge action,
configurable retention window. Bridge stays outward-polling. Pay-gate+auth+envelope on
every endpoint. Firestore rules stay deny-all.

Milestones: 1 config+data · 2 session state machine · 3 recommend engine (from serverModel)
· 4 message layer + AI + closed-action test · 5 bridge integration (concierge.lua, no
write/spawn/teleport) · 6 analytics (funnel + retention + arrivals + question themes) ·
7 owner dashboard (setup/funnel/retention/arrivals/themes, EN/AR 380px) · 8 docs + keep
139 tests green + smoke.
