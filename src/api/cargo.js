

// Warehouse stock and in-transit cargo data.

import VEHICLES from "../data/vehicleData";

function byCompany(companyId) {
  return companyId ? VEHICLES.filter((v) => v.companyId === companyId) : VEHICLES;
}

export async function getStockInTransit({ companyId } = {}) {

  const inTransit = byCompany(companyId).filter((v) => v.status !== "parked");

  const groups = {};
  inTransit.forEach((v) => {
    if (!groups[v.cargo]) groups[v.cargo] = { cargoName: v.cargo, tonnage: 0, vehicleCount: 0 };
    groups[v.cargo].tonnage += v.weight;
    groups[v.cargo].vehicleCount += 1;
  });

  return Object.values(groups);
}

export async function getWarehouseStock({ companyId } = {}) {

  const inTransit = await getStockInTransit({ companyId });

  const seedFor = (name) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h;
  };

  return inTransit.map(({ cargoName, tonnage }) => {
    const seed = seedFor(cargoName + (companyId || ""));
    const multiplier = 2 + (seed % 20) / 10;
    return { cargoName, tonnage: Math.round(tonnage * multiplier) };
  });
}
