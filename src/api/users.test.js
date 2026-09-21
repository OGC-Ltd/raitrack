/**
 * Merging several organisations' rosters into one list.
 *
 * ## The requirement this serves
 *
 * An administrator added to organisation A and organisation B may edit and
 * delete people in both, from one session, without switching company. The
 * server has always permitted it — every user-admin route takes the
 * organisation from the URL path and never from the caller's own, and
 * middleware/authorize.ts says so in as many words. What was missing was a
 * roster that could show both at once.
 *
 * ## What these pin
 *
 * Two properties, and both of them are load-bearing:
 *
 *   · every row carries the organisation it was READ from, because that is the
 *     organisation its Delete button has to be addressed to; and
 *   · one organisation failing costs its own rows and nothing else.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const apiFetch = vi.fn();
vi.mock("../services/api", () => ({ apiFetch: (...args) => apiFetch(...args) }));

const { listUsersAcrossOrgs } = await import("./users");

const roster = (...names) => ({
  data: names.map((n) => ({ id: `u-${n}`, fullName: n })),
  meta: { total: names.length },
});

beforeEach(() => { apiFetch.mockReset(); });

describe("listUsersAcrossOrgs", () => {
  it("stamps every row with the organisation it was read from", async () => {
    apiFetch.mockImplementation((url) =>
      Promise.resolve(url.includes("org-a") ? roster("Ada") : roster("Ben")));

    const { users } = await listUsersAcrossOrgs(["org-a", "org-b"]);

    // Not user.organisationId, which is who EMPLOYS them and does not move
    // when they are granted a second tenant. Addressing a write by that field
    // would edit the wrong membership.
    expect(users.map((u) => [u.fullName, u.scopeOrgId])).toEqual([
      ["Ada", "org-a"],
      ["Ben", "org-b"],
    ]);
  });

  it("keeps one person once PER ORGANISATION rather than deduplicating them", async () => {
    // Deliberate. "Dispatcher at A" and "Operator at B" are different rows
    // with different chips and different buttons, and suspending them in one
    // is not suspending them in the other.
    apiFetch.mockResolvedValue(roster("Ada"));

    const { users } = await listUsersAcrossOrgs(["org-a", "org-b"]);

    expect(users).toHaveLength(2);
    expect(users.every((u) => u.id === "u-Ada")).toBe(true);
    expect(users.map((u) => u.scopeOrgId)).toEqual(["org-a", "org-b"]);
  });

  it("lets one organisation fail without blanking the others", async () => {
    apiFetch.mockImplementation((url) =>
      url.includes("org-b")
        ? Promise.reject(new Error("403"))
        : Promise.resolve(roster("Ada")));

    const { users, failures } = await listUsersAcrossOrgs(["org-a", "org-b"]);

    expect(users.map((u) => u.fullName)).toEqual(["Ada"]);
    // Named, because a combined list that is quietly short reads as complete.
    expect(failures.map((f) => f.orgId)).toEqual(["org-b"]);
  });

  it("asks for each organisation exactly once, however often it was named", async () => {
    apiFetch.mockResolvedValue(roster("Ada"));
    await listUsersAcrossOrgs(["org-a", "org-a", null, undefined, "org-a"]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not call the server at all for an empty scope", async () => {
    await expect(listUsersAcrossOrgs([])).resolves.toEqual({ users: [], total: 0, failures: [] });
    await expect(listUsersAcrossOrgs(undefined)).resolves.toEqual({ users: [], total: 0, failures: [] });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("scopes each request to system accounts, not to the 549 synced drivers", async () => {
    apiFetch.mockResolvedValue(roster("Ada"));
    await listUsersAcrossOrgs(["org-a"]);
    expect(apiFetch.mock.calls[0][0]).toContain("access=system");
  });
});
