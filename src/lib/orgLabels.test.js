import { describe, it, expect } from "vitest";
import { navLabel, withOrgLabel, peopleWords } from "./orgLabels";

describe("orgLabels", () => {
  it("names Drivers 'Staffs' for Mufindi (KASULU) only", () => {
    expect(navLabel("drivers", "Drivers", "KASULU")).toBe("Staffs");
    expect(navLabel("drivers", "Drivers", "kasulu")).toBe("Staffs");
    expect(navLabel("drivers", "Drivers", "SUKARI")).toBe("Drivers");
    expect(navLabel("drivers", "Drivers", null)).toBe("Drivers");
    expect(navLabel("reports", "Reports", "KASULU")).toBe("Reports");
  });
  it("keeps the item when nothing changes", () => {
    const item = { key: "drivers", label: "Drivers" };
    expect(withOrgLabel(item, "MENENGAI")).toBe(item);
    expect(withOrgLabel(item, "KASULU")).toEqual({ key: "drivers", label: "Staffs" });
  });
  it("gives the page's words", () => {
    expect(peopleWords("KASULU")).toEqual({ one: "staff", many: "staffs", title: "Staff" });
    expect(peopleWords("SUKARI").many).toBe("drivers");
  });
});
