import { describe, it, expect } from "vitest";
import {
  keyOf, resolveEverywhere, resolveIn, spread, standingGrants, toChanges, withChoice,
} from "./iamAccess";

const A = { id: "a", fromRoles: ["map:read", "report:read"] };
const B = { id: "b", fromRoles: ["map:read"] };
const grant = (organisationId, permission, effect) => ({ organisationId, permission, effect });

describe("standingGrants", () => {
  it("lays pending changes over what is saved", () => {
    const standing = standingGrants(
      [grant("a", "report:read", "deny"), grant(null, "trip:read", "allow")],
      new Map([[keyOf("a", "report:read"), "inherit"], [keyOf("b", "fuel_audit:read"), "allow"]]),
    );
    expect(standing.has(keyOf("a", "report:read"))).toBe(false);
    expect(standing.get(keyOf(null, "trip:read"))).toBe("allow");
    expect(standing.get(keyOf("b", "fuel_audit:read"))).toBe("allow");
  });
});

describe("resolveIn", () => {
  it("follows the role when nothing is personal", () => {
    expect(resolveIn(A, "report:read", new Map())).toEqual({ held: true, fromRole: true, source: "role" });
    expect(resolveIn(B, "report:read", new Map())).toEqual({ held: false, fromRole: false, source: "role" });
  });

  it("gives what the role does not", () => {
    const standing = standingGrants([grant("b", "report:read", "allow")]);
    expect(resolveIn(B, "report:read", standing)).toMatchObject({ held: true, source: "allow" });
    expect(resolveIn(A, "trip:read", standing).held).toBe(false);
  });

  it("applies a grant made for every organisation", () => {
    const standing = standingGrants([grant(null, "trip:read", "allow")]);
    expect(resolveIn(A, "trip:read", standing)).toMatchObject({ held: true, source: "allow-all" });
  });

  it("lets a denial beat an allowance, in either scope", () => {
    expect(resolveIn(A, "trip:read", standingGrants([
      grant(null, "trip:read", "allow"), grant("a", "trip:read", "deny"),
    ]))).toMatchObject({ held: false, source: "deny" });
    expect(resolveIn(A, "trip:read", standingGrants([
      grant("a", "trip:read", "allow"), grant(null, "trip:read", "deny"),
    ]))).toMatchObject({ held: false, source: "deny-all" });
  });
});

describe("resolveEverywhere", () => {
  it("counts the organisations", () => {
    const standing = standingGrants([grant("b", "map:read", "deny")]);
    expect(resolveEverywhere([A, B], "map:read", standing)).toEqual({ total: 2, fromRole: 2, held: 1 });
    expect(spread(2, 2)).toBe("all");
    expect(spread(1, 2)).toBe("some");
    expect(spread(0, 2)).toBe("none");
    expect(spread(0, 0)).toBe("none");
  });
});

describe("withChoice and toChanges", () => {
  it("drops a choice that is what the server already holds", () => {
    const saved = [grant("a", "report:read", "deny")];
    let pending = withChoice(new Map(), saved, "a", "report:read", "allow");
    expect(pending.size).toBe(1);
    pending = withChoice(pending, saved, "a", "report:read", "deny");
    expect(pending.size).toBe(0);
    expect(withChoice(new Map(), saved, "b", "report:read", "inherit").size).toBe(0);
  });

  it("sends the every-organisation scope as null", () => {
    const pending = new Map([[keyOf(null, "trip:read"), "allow"], [keyOf("a", "map:read"), "inherit"]]);
    expect(toChanges(pending)).toEqual([
      { organisationId: null, permission: "trip:read", effect: "allow" },
      { organisationId: "a", permission: "map:read", effect: "inherit" },
    ]);
  });
});

describe("Full access", () => {
  const org = { id: "a", fromRoles: ["map:read"] };
  it("carries every right but the excluded ones once given", () => {
    const standing = new Map([[keyOf("a", "access:full"), "allow"]]);
    expect(resolveIn(org, "user:delete", standing)).toMatchObject({ held: true, source: "full" });
    expect(resolveIn(org, "repair:take_jobs", standing).held).toBe(false);
    expect(resolveIn(org, "vehicle:flagged_only", standing).held).toBe(false);
  });
  it("a denial still wins", () => {
    const standing = new Map([[keyOf("a", "access:full"), "allow"], [keyOf("a", "user:delete"), "deny"]]);
    expect(resolveIn(org, "user:delete", standing).held).toBe(false);
  });
  it("carries nothing in another organisation", () => {
    const standing = new Map([[keyOf("a", "access:full"), "allow"]]);
    expect(resolveIn({ id: "b", fromRoles: [] }, "user:delete", standing).held).toBe(false);
  });
});
