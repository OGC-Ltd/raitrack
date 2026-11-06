import { describe, expect, it } from "vitest";
import { groupLoginActivity } from "./loginActivityView";

describe("groupLoginActivity", () => {
  it("groups repeated sign-ins by user and East Africa calendar day", () => {
    const rows = [
      { id: "one", loggedInAt: "2026-11-05T21:30:00Z", user: { id: "ada", fullName: "Ada" } },
      { id: "two", loggedInAt: "2026-11-05T22:00:00Z", user: { id: "ada", fullName: "Ada" } },
      { id: "three", loggedInAt: "2026-11-05T21:30:00Z", user: { id: "grace", fullName: "Grace" } },
      { id: "four", loggedInAt: "2026-11-06T00:15:00Z", user: { id: "ada", fullName: "Ada" } },
    ];

    const groups = groupLoginActivity(rows);

    expect(groups.map(({ user, day, events }) => [user.fullName, day, events.length])).toEqual([
      ["Ada", "2026-11-06", 3],
      ["Grace", "2026-11-06", 1],
    ]);
    expect(groups[0].events.map((event) => event.id)).toEqual(["four", "two", "one"]);
  });

  it("returns no rows for an empty report", () => {
    expect(groupLoginActivity([])).toEqual([]);
  });
});
