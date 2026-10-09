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
