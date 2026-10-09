import { describe, expect, test } from "vite-plus/test";
import { toastOf } from "../../src/shared/ui/toasts.ts";

describe("toasts", () => {
  test("take their tone from the caller and default to plain", () => {
    expect(toastOf("Restarting the shell").variant).toBe("default");
    expect(toastOf("Nova needs you", "warning").variant).toBe("warning");
  });

  test("errors linger longer than other messages", () => {
    expect(toastOf("No gh", "error").timeout).toBeGreaterThan(toastOf("Done", "success").timeout);
  });
});
