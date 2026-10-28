import { describe, it, expect } from "vitest";
import { accessMailNote, retryClock } from "./accessMail";

const NOW = new Date(2026, 9, 28, 21, 0);

describe("accessMailNote", () => {
  it("says sent only when the provider took it", () => {
    expect(accessMailNote({ sent: true }, "Invitation", "a@b.c", NOW))
      .toEqual({ state: "sent", text: "Invitation emailed to a@b.c." });
  });

  it("names the quota and the retry time", () => {
    const retryAt = new Date(2026, 9, 28, 22, 10).toISOString();
    const n = accessMailNote({ sent: false, reason: "queued", because: "provider-quota", retryAt }, "Invitation", "a@b.c", NOW);
    expect(n.state).toBe("pending");
    expect(n.text).toMatch(/daily limit/);
    expect(n.text).toContain(retryClock(retryAt, NOW));
    expect(n.text).not.toMatch(/tomorrow/);
  });

  it("says tomorrow when the retry crosses midnight", () => {
    const retryAt = new Date(2026, 9, 29, 1, 5).toISOString();
    expect(retryClock(retryAt, NOW)).toMatch(/tomorrow$/);
  });

  it("keeps a plain queued answer from an older server pending, not failed", () => {
    expect(accessMailNote({ sent: false, reason: "queued" }, "Reset link", "a@b.c", NOW).state).toBe("pending");
  });

  it("explains a failure", () => {
    expect(accessMailNote({ sent: false, reason: "unconfigured" }, "Invitation", "a@b.c", NOW))
      .toEqual({ state: "failed", text: "Invitation not sent, email is not configured on the server." });
  });
});
