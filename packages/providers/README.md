# @mothership/providers

Agent CLI adapters. Each `ProviderAdapter` knows how to launch its CLI (`launchPlan`) and how to turn its hook payloads into crew signals (`parseHook`).

- `claudeCode`: runs `claude --settings <hooks> -- <brief>`. Hooks are command hooks that `curl` the payload to the station (`$MOTHERSHIP_HOOK_URL`) with the crew id and token from the environment; they time out fast and never fail, so a down station can't block Claude.

```bash
vp test
vp pack
```
