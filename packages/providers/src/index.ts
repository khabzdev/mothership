export { HOOK_EVENTS, claudeCode } from "./claude-code.ts";
export { shell } from "./shell.ts";
export type * from "./types.ts";

import { claudeCode } from "./claude-code.ts";
import { shell } from "./shell.ts";
import type { ProviderAdapter } from "./types.ts";

export const PROVIDERS: Record<string, ProviderAdapter> = {
  [claudeCode.id]: claudeCode,
  [shell.id]: shell,
};
