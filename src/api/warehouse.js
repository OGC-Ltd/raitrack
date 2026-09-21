

// Depot dashboard data: stock, deliveries, holds, alerts.

import VEHICLES from "../data/vehicleData";
import DEPOTS_BY_COMPANY from "../data/depotData";

function depotsFor(companyId) {
  return DEPOTS_BY_COMPANY[companyId] || DEPOTS_BY_COMPANY.sukari;
}

function vehiclesFor(companyId) {
  return companyId ? VEHICLES.filter((v) => v.companyId === companyId) : VEHICLES;
}

function seedFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function groupByCargo(vehicles) {
  const groups = {};
  vehicles.forEach((v) => {
    if (!groups[v.cargo]) groups[v.cargo] = 0;
    groups[v.cargo] += v.weight;
  });
  return Object.entries(groups)
    .map(([cargo, tonnes]) => ({ cargo, tonnes }))
    .sort((a, b) => b.tonnes - a.tonnes);
}

export async function getWarehouseKPIs({ companyId } = {}) {

  const vehicles = vehiclesFor(companyId);
  const depots = depotsFor(companyId);
  const cargoTypes = [...new Set(vehicles.map((v) => v.cargo))];

  const incoming = vehicles.filter((v) => v.status !== "parked" && depots.some((d) => d.name === v.destination));
  const outgoing = vehicles.filter((v) => v.status !== "parked" && depots.some((d) => d.name === v.departure));
  const flagged = vehicles.filter((v) => v.status === "theft");

  const incomingUnits = incoming.reduce((sum, v) => sum + v.weight, 0);
  const outgoingUnits = outgoing.reduce((sum, v) => sum + v.weight, 0);

  const seed = seedFor(companyId || "sukari");
  const inStockTotal = Math.round((incomingUnits + outgoingUnits) * (3 + (seed % 20) / 10));
  const inStockByCargo = cargoTypes.map((cargo, i) => {
    const share = 0.4 + (seedFor(cargo) % 40) / 100;
    const weight = cargoTypes.length === 1 ? 1 : share / cargoTypes.length + (i === 0 ? 0.3 : 0);
    return { cargo, tonnes: Math.round(inStockTotal * weight) };
  });

  const normaliseSum = inStockByCargo.reduce((s, c) => s + c.tonnes, 0);
  if (normaliseSum > 0) {
    inStockByCargo.forEach((c) => { c.tonnes = Math.round((c.tonnes / normaliseSum) * inStockTotal); });
  }

  return {
    inStock: { tonnes: inStockTotal, byCargo: inStockByCargo },
    incoming: { tonnes: incomingUnits, truckCount: incoming.length, byCargo: groupByCargo(incoming) },
    outgoing: { tonnes: outgoingUnits, orderCount: outgoing.length, byCargo: groupByCargo(outgoing) },
    qualityHolds: { count: flagged.length, needsInspection: flagged.length },
  };
}

export async function getDepots({ companyId } = {}) {

  const vehicles = vehiclesFor(companyId);
  const depots = depotsFor(companyId);

  return depots.map((d) => {
    const seed = seedFor(d.name);
    const stockTonnes = 8000 + (seed % 40000);
    const inbound = vehicles.filter((v) => v.status !== "parked" && v.destination === d.name).length;
    return { ...d, stockTonnes, inbound };
  });
}

export async function getIncomingDeliveries({ companyId } = {}) {

  const vehicles = vehiclesFor(companyId);
  const depots = depotsFor(companyId);
  const depotNames = new Set(depots.map((d) => d.name));
  const mainHub = depots.find((d) => d.role === "Main hub");

  const incoming = vehicles.filter((v) => v.status !== "parked" && depotNames.has(v.destination));

  return incoming
    .map((v) => {
      const seed = seedFor(v.id);
      const minutesOut = 15 + (seed % 240);
      const status = v.status === "speeding" ? "warn" : (seed % 5 === 0 ? "warn" : "good");
      return {
        vehicleId: v.id,
        driver: v.driver,
        departure: v.departure,
        destination: v.destination,
        toMainHub: mainHub?.name === v.destination,
        cargo: v.cargo,
        weight: v.weight,
        minutesOut,
        status,
        statusLabel: status === "good" ? "On time" : `${5 + (seed % 25)} min late`,
      };
    })
    .sort((a, b) => a.minutesOut - b.minutesOut);
}

export async function getOutboundDispatch({ companyId } = {}) {

  const vehicles = vehiclesFor(companyId);
  const depots = depotsFor(companyId);
  const depotNames = new Set(depots.map((d) => d.name));

  const outgoing = vehicles.filter((v) => v.status !== "parked" && depotNames.has(v.departure));

  const groups = {};
  outgoing.forEach((v) => {
    if (!groups[v.departure]) groups[v.departure] = { depot: v.departure, orderCount: 0, vehicles: [] };
    groups[v.departure].orderCount += 1;
    groups[v.departure].vehicles.push(v);
  });

  return Object.values(groups).map((g) => {
    const seed = seedFor(g.depot);
    const progress = 10 + (seed % 90);
    return {
      depot: g.depot,
      orderCount: g.orderCount,
      progress,
      status: progress >= 100 ? "good" : progress < 20 ? "neutral" : "info",
      statusLabel: progress >= 100 ? "Packed & ready" : progress < 20 ? "Just started" : `${progress}% picked`,
    };
  });
}

export async function getQualityHolds({ companyId } = {}) {

  const vehicles = vehiclesFor(companyId);
  const flagged = vehicles.filter((v) => v.status === "theft");
  const seed = seedFor(companyId || "sukari");

  const underInspection = flagged.length;
  const rejected = seed % 3;
  const cleared = 2 + (seed % 6);

  return {
    total: underInspection + rejected + cleared,
    underInspection,
    rejected,
    cleared,
  };
}

export async function getStockByProduct({ companyId } = {}) {

  const vehicles = vehiclesFor(companyId);
  const depots = depotsFor(companyId);
  const cargoTypes = [...new Set(vehicles.map((v) => v.cargo))];

  return cargoTypes.map((cargo) => {
    const perDepot = depots.map((d) => {
      const seed = seedFor(cargo + d.name);
      return { depot: d.name, tonnes: 200 + (seed % 4000) };
    });
    const total = perDepot.reduce((sum, p) => sum + p.tonnes, 0);
    const daysLeft = 3 + (seedFor(cargo + "days") % 40);
    const status = daysLeft <= 5 ? "bad" : daysLeft <= 12 ? "warn" : "good";

    return {
      cargo,
      perDepot,
      total,
      daysLeft,
      status,
      statusLabel: status === "bad" ? "Order now" : status === "warn" ? "Reorder soon" : "Healthy",
    };
  });
}

export async function getWarehouseAlerts({ companyId } = {}) {

  const depots = await getDepots({ companyId });
  const stockByProduct = await getStockByProduct({ companyId });

  const alerts = [];

  const nearlyFull = depots.find((d) => d.capacityPct >= 90);
  if (nearlyFull) {
    alerts.push({
      severity: "bad",
      title: `${nearlyFull.name} is almost full (${nearlyFull.capacityPct}%)`,
      detail: `${nearlyFull.inbound} more delivery${nearlyFull.inbound === 1 ? " is" : "s are"} inbound today — consider rerouting to a depot with more room.`,
    });
  }

  const lowStock = stockByProduct.find((s) => s.status === "bad");
  if (lowStock) {
    alerts.push({
      severity: "bad",
      title: `${lowStock.cargo} is running low`,
      detail: `About ${lowStock.daysLeft} days of stock left across all depots. Consider scheduling more collection trips.`,
    });
  }

  const reorderSoon = stockByProduct.find((s) => s.status === "warn");
  if (reorderSoon) {
    alerts.push({
      severity: "warn",
      title: `${reorderSoon.cargo} stock is getting low`,
      detail: `About ${reorderSoon.daysLeft} days of stock left — worth planning ahead.`,
    });
  }

  return alerts;
}
