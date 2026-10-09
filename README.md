# Mothership

A 3D space station for running coding agents. Each repo is a deck, agents are crew, and features ship as missions: brief → build → Go/No-Go → airlock (PR).

## Workspace

Vite+ monorepo. Packages use the `@mothership/*` scope.

- `apps/station`: TanStack Start + Query + React Three Fiber app
- `packages/*`: `mission-engine`, `protocol`, `providers`, `ptyhost`

## Development

```bash
vp install
vp run ready   # check + test + build
vp run dev     # start the station
```

## Credits

3D models: [KayKit](https://kaylousberg.com) Space Base Bits and Adventurers Character Pack by Kay Lousberg (CC0). Bulkheads, door frames, windows and floor tiles: [Kenney](https://kenney.nl) Space Station Kit (CC0), in `apps/station/public/models/station`.
