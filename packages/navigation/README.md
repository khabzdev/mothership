# @mothership/navigation

Pure (no I/O, browser-safe) navigation logic for crew on a deck.

- `resolveWaypoint(signal, deck)`: hook activity + status + mission phase → where the crew member should be
- `propose` / `tick`: minimum-dwell scheduler so rapid tool calls don't cause zig-zagging (red alert skips it)

```bash
vp test
vp pack
```
