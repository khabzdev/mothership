export { HOOK_EVENTS, claudeCode } from "./claude-code.ts";
export type * from "./types.ts";

import { claudeCode } from "./claude-code.ts";
import type { ProviderAdapter } from "./types.ts";

export const PROVIDERS: Record<string, ProviderAdapter> = { [claudeCode.id]: claudeCode };
