import { describe, expect, test } from "vite-plus/test";
import { toneOf } from "../../src/shared/ui/toasts.ts";

describe("toast tone", () => {
  test("is read off the emoji the message starts with", () => {
    expect(toneOf("⚠️ Install the GitHub CLI")).toBe("error");
    expect(toneOf("✅ Pulsar is done")).toBe("success");
    expect(toneOf("🙋 Nova needs you")).toBe("warning");
    expect(toneOf("Restarting the shell")).toBe("default");
  });
});
