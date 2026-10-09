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
    expect(placeActivity({ name: "Nyaondo Waybridge-Sukari Industries Ltd", types: ["establishment"] })).toBe("Industrial / works");
    expect(placeActivity({ name: "Trans Mara Oyani Cane Buying Centre", types: ["establishment"] })).toBe("Industrial / works");
    expect(placeActivity({ name: "Kenya Breweries Industries", types: ["establishment"] })).toBe("Industrial / works");
  });
  it("reads the name where Google types a place only as a point of interest", () => {
    const poi = ["point_of_interest", "establishment"];
    expect(placeActivity({ name: "Rodesa Filling Station", types: poi })).toBe("Fuel");
    expect(placeActivity({ name: "Suez Energy Station", types: poi })).toBe("Fuel");
    expect(placeActivity({ name: "MULTIDOSE AGRO SUPPLIES", types: poi })).toBe("Shopping");
    expect(placeActivity({ name: "Bungoma Teachers Sacco", types: poi })).toBe("Banking");
    expect(placeActivity({ name: "St Mary's Dispensary", types: poi })).toBe("Medical");
    expect(placeActivity({ name: "Kwa Mama Butchery", types: poi })).toBe("Food and drink");
    expect(placeActivity({ name: "ROYAL MOTORS OFFICIAL", types: poi })).toBe("Vehicle service");
  });
  it("lets the name beat Google's bare store type, not its specific ones", () => {
    expect(placeActivity({ name: "Afya Chemist", types: ["store", "point_of_interest"] })).toBe("Medical");
    expect(placeActivity({ name: "Seamrise Enterprise Ltd", types: ["store"] })).toBe("Shopping");
    expect(placeActivity({ name: "Mama Pima", types: ["store"] })).toBe("Shopping");
    expect(placeActivity({ name: "DEVOTER HOTEL", types: ["hotel", "lodging"] })).toBe("Lodging");
  });
  it("says nothing when nothing says what it is", () => {
    expect(placeActivity({ name: "Mama Pima", types: ["point_of_interest", "establishment"] })).toBeNull();
    expect(placeActivity(null)).toBeNull();
  });
});
