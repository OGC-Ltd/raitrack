// Depots per company: name, role, location, capacity.



const DEPOTS_BY_COMPANY = {
  sukari: [
    { name: "Sukari Industries, Thika", role: "Main hub",     lat: -1.0332, lng: 37.0693, capacityPct: 78, dockCount: 6 },
    { name: "Nairobi CBD Warehouse",    role: "Distribution", lat: -1.2921, lng: 36.8219, capacityPct: 64, dockCount: 4 },
    { name: "Mombasa Port Depot",       role: "Port",         lat: -4.0435, lng: 39.6682, capacityPct: 42, dockCount: 5 },
    { name: "Nakuru Depot #3",          role: "Regional",     lat: -0.3031, lng: 36.0800, capacityPct: 91, dockCount: 3 },
  ],
  // Empty, not absent. `depotsFor` falls back to Sukari's list for a company
  // it does not know, so an org added here without an entry would show another
  // customer's depots — with their names, coordinates and stock — as its own.
  kasulu: [],
  menengai: [],
  westsugar: [],
};

export default DEPOTS_BY_COMPANY;
