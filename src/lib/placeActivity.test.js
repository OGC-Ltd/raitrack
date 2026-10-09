import { describe, it, expect } from "vitest";
import { placeActivity } from "./placeActivity";

describe("placeActivity", () => {
  it("groups Google's types into what the stop was for", () => {
    expect(placeActivity({ primaryType: "bank", types: ["bank", "finance", "point_of_interest"] })).toBe("Banking");
    expect(placeActivity({ primaryType: "kenyan_restaurant", types: ["restaurant", "food"] })).toBe("Food and drink");
    expect(placeActivity({ types: ["pharmacy", "store", "health"] })).toBe("Medical");
    expect(placeActivity({ types: ["gas_station", "convenience_store"] })).toBe("Fuel");
    expect(placeActivity({ primaryType: "shoe_store", types: ["point_of_interest"] })).toBe("Shopping");
  });
  it("falls back on the name for industry and offices", () => {
    expect(placeActivity({ name: "West Kenya Sugar - Lake Agro workshop", types: ["point_of_interest", "establishment"] })).toBe("Industrial / works");
    expect(placeActivity({ name: "Rai Group Offices", types: ["establishment"] })).toBe("Offices");
  });
  it("says nothing when nothing says what it is", () => {
    expect(placeActivity({ name: "Mama Pima", types: ["point_of_interest", "establishment"] })).toBeNull();
    expect(placeActivity(null)).toBeNull();
  });
});
