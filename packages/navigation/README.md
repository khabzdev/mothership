# @spaceship/navigation

Pure (no I/O, browser-safe) navigation logic for crew on a deck.

- `resolveWaypoint(signal, deck)`: hook activity + status + mission phase → where the crew member should be
- `layoutDeck(modules)`: top-level dirs → tile grid with a spine corridor, module rooms, facilities, hub and lift (`renderAscii` for debugging)
- `pointFor(layout, waypoint)`: the tile a crew member stands on
- `findPath(layout, from, to)`: A* over the tile grid; corridors cost 1, open ground 3, so crew stick to the spine
- `propose` / `tick`: minimum-dwell scheduler so rapid tool calls don't cause zig-zagging (red alert skips it)

```bash
vp test
vp pack
```
