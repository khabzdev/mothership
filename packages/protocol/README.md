# @mothership/protocol

Typed WebSocket messages between the station UI (client) and the station server.

- `ClientMsg`: browser → server (terminal input, resize, attach/detach)
- `ServerMsg`: server → browser (terminal output, crew status, mission updates)
- `encode` / `parseClientMsg` / `parseServerMsg`: JSON framing with runtime guards for untrusted input

```bash
vp test
vp pack
```
