// Push subscriptions go to the organisation's id, not the company slug.
//
// The header and the account screen hold "kasulu"; the server answers a slug
// with 400, so no device was ever registered from the web app (2026-11-24).

import { describe, it, expect, vi, beforeEach } from "vitest";

const apiFetch = vi.fn();
vi.mock("../services/api", () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock("../api/org", () => ({
  resolveOrgId: async (c) => ({ kasulu: "cms0oo1n40000fwv7r1u4pg36" })[c] ?? null,
}));

const { refreshPush, disablePush } = await import("./pushNotifications");

const sub = { endpoint: "https://push.example/abc", toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } }), unsubscribe: vi.fn() };

beforeEach(() => {
  apiFetch.mockReset().mockResolvedValue({});
  const Notification = { permission: "granted" };
  vi.stubGlobal("Notification", Notification);
  vi.stubGlobal("window", { PushManager: function PushManager() {}, Notification });
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) },
  });
});

describe("push subscriptions", () => {
  it("re-sends the subscription under the organisation id", async () => {
    await refreshPush("kasulu");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe("/api/v1/organisations/cms0oo1n40000fwv7r1u4pg36/notifications/subscribe");
  });

  it("sends nothing for a company with no organisation", async () => {
    await refreshPush("nowhere");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("removes the subscription under the organisation id", async () => {
    await disablePush("kasulu");
    expect(apiFetch.mock.calls[0][0]).toBe("/api/v1/organisations/cms0oo1n40000fwv7r1u4pg36/notifications/subscribe");
    expect(apiFetch.mock.calls[0][1].method).toBe("DELETE");
  });
});
