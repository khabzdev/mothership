# @mothership/ptyhost

Standalone process that owns crew terminals, so agents keep running when the station restarts.

- Listens on `127.0.0.1` (random port) and writes `{ port, token, pid }` to `$MOTHERSHIP_HOME/ptyhost.json` (mode 0600). Clients must send `Authorization: Bearer <token>`.
- Each session is a PTY (`@lydell/node-pty`) mirrored into a headless xterm; `attach` returns a screen snapshot, then streams live output.
- `ensurePtyHost({ home })` reuses a running host or launches a detached one.

```bash
vp test
vp pack
vp run start   # run a host in the foreground
```
