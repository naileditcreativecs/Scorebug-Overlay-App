# CFB27 broadcast-banner research (from MMC Editor asset dictionary)

Source: strings.txt (160 MB asset-name dictionary) in MMC_Editor_v1.1.0.2.
GUI automation of the editor via synthetic clicks did NOT work (WPF app
ignores SetCursorPos+mouse_event); pivoted to reading the dictionary on disk.

## The stat lower-third IS a "GameBanner" in the Rime UI framework

- Presentation source: `.../broadcast/BroadcastSystemBanner/dev/source/
  BroadcastSystemBanner/gamebanners/gamebanner`
- Proxy: `.../BroadcastProxyBanner/.../ProxyBanner`
- Types: `GameBanner`, `GameBannerBuilder`, `GameBanners`, `SystemBanner`
- Data feeder (fills the banner): **`RimeBannerDataFeeder` /
  `RimeBannerDataFeederData`**, `RimeBannerData`, `RimeBannerEntity`,
  `RimeBannerDataUpdatedMessage`
- Presented/timed by the Muse system: `BroadcastSystemMuse/.../presentation/
  PresMgrMuse`, `BroadcastSystemPresentation/.../features/PresentationMgr`

## MOD ANGLE: duration properties exist and are editable-looking

Banner on-screen time is governed by hold-time properties, not hardcoded:
`DisplayTime`, `HoldTime`, `EventDisplayTime`, `DisplayTimeout`,
`MaxHoldTime`/`minHoldTime`, and a flag **`AlwaysUseMaxHoldTimes`**
(+ `ToggleMaxHoldTime`, `IsMaxHoldTime`). A mod that maximizes the game
banner's MaxHoldTime and sets AlwaysUseMaxHoldTimes could keep a shown
banner on screen far longer - giving the reader a long, reliable capture
window. CAVEAT: duration controls how long a banner STAYS, not whether it
is TRIGGERED - the Muse presentation system still decides when to fire one.
So a duration mod multiplies capture time per event but does not by itself
make every player's banner appear. Full "always present" likely needs the
presentation trigger too (deeper).

## BIG payoff for the READER (independent of any mod)

`RimeBannerDataFeeder`/`RimeBannerData` is a STRUCTURED per-banner data
object the game fills before drawing - the numbers exist in memory as data,
not just rendered text. Finding the RimeBannerData object is a cleaner
reader target than scraping ScoreHud text, and it dovetails with the
stat-table work already underway.

## Complete player-stat vocabulary (for reader parsing/labeling)

AudioPlayerStatType_* enumerates every tracked stat:
FirstDowns, ForcedFumblesDefender, FumbleRecoveries, Fumbles, FumblesLost,
IntsCaught, LongestPass, LongestReception, LongestRush, Pass, PassAttempts,
PassCompletes, PassPercentage, PassYards, Receiver, ReceiverAttempts,
ReceiverCompletes, ReceiverYards, Rush, RushAttempts, RushYards,
SacksDefender, TacklesDefender, TotalTDs, TotalYards.
Drive-level: AudioDriveStatType_* (NumPlays, PassingYards, RushingYards,
PassTD, RushTD, ThirdDownConversions, TotalYards, TotalTime, etc.).

## Next steps

1. Reader: hunt the RimeBannerData / stat-table object families (the
   structured stat store) - the reliable, mod-free path to always-on stats.
2. Mod (optional multiplier): in MMC Editor, open the gamebanner
   presentation asset, raise MaxHoldTime + set AlwaysUseMaxHoldTimes so each
   shown banner lingers for a long capture window. Needs hands-on editor
   testing (GUI automation unreliable) or CFMC community guidance - give
   them the exact asset path above.
