# @spaceship/station

The Spaceship app: TanStack Start + TanStack Query, served by Nitro on 127.0.0.1 only.

```
src/
  app/        router context, query client, app-wide server fns
  routes/     file-based routes (routeTree.gen.ts is generated)
  features/   decks · missions · crew · preflight (ui · api · model · scene)
  shared/     ui kit, db, realtime client, r3f helpers
```

Server functions live in `*.functions.ts`, server-only code in `*.server.ts`.

```bash
vp run dev     # http://127.0.0.1:3000
vp run build
vp run start   # run the built server
```
