// Depot tab: command-center style KPIs, stock, deliveries, holds.

import { useState } from "react";
import "./WarehouseDashboard.css";
import {
  getWarehouseKPIs, getDepots, getIncomingDeliveries,
  getOutboundDispatch, getQualityHolds, getStockByProduct, getWarehouseAlerts,
} from "../../api/warehouse";
import { useAppSelector, useCompanies } from "../../context/AppContext";
import { useApiData } from "../../hooks/useApiData";
import ErrorBoundary from "../shared/ErrorBoundary";
import LoadError from "../shared/LoadError";
import DownloadReportButton from "../shared/DownloadReportButton";
import { createReport, addSectionTitle, addSummaryCards, addTable, downloadReport } from "../../utils/pdfReport";

function Pill({ tone = "neutral", children }) {
  return <span className={`wh-pill wh-pill--${tone}`}>{children}</span>;
}

function Bar({ pct, tone = "info" }) {
  return (
    <div className="wh-bar">
      <span className={`wh-bar-fill wh-bar-fill--${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

// Fetch all depot data for the active company.
export default function WarehouseDashboard() {
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { activeCompany } = useCompanies();

  const { data, loading, error, retry } = useApiData(
    () => Promise.all([
      getWarehouseKPIs({ companyId: activeCompanyId }),
      getDepots({ companyId: activeCompanyId }),
      getIncomingDeliveries({ companyId: activeCompanyId }),
      getOutboundDispatch({ companyId: activeCompanyId }),
      getQualityHolds({ companyId: activeCompanyId }),
      getStockByProduct({ companyId: activeCompanyId }),
      getWarehouseAlerts({ companyId: activeCompanyId }),
    ]),
    [activeCompanyId]
  );

  const [kpis, depots, incoming, outbound, holds, stock, alerts] = data || [null, [], [], [], null, [], []];

  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("all");
  const filteredIncoming = incoming.filter((d) => {
    const q = deliverySearch.trim().toLowerCase();
    const matchesQuery = !q ||
      d.vehicleId.toLowerCase().includes(q) ||
      d.driver.toLowerCase().includes(q) ||
      d.cargo.toLowerCase().includes(q) ||
      d.destination.toLowerCase().includes(q) ||
      d.departure.toLowerCase().includes(q);
    const matchesStatus = deliveryStatusFilter === "all" || d.status === deliveryStatusFilter;
    return matchesQuery && matchesStatus;
  });

  // Build and download the PDF report.
  const handleDownloadReport = () => {
    const doc = createReport({
      companyName: activeCompany?.name || "Fleet Tracking",
      reportTitle: "Depot Report",
      subtitle: `${depots.length} depots`,
      accentColor: activeCompany?.accentColor,
    });

    addSummaryCards(doc, [
      { label: "In Stock (t)", value: kpis.inStock.tonnes, color: "#1f6feb" },
      { label: "Incoming (t)", value: kpis.incoming.tonnes, color: "#b0630b" },
      { label: "Outgoing (t)", value: kpis.outgoing.tonnes, color: "#137a4a" },
      { label: "Quality Holds", value: kpis.qualityHolds.count, color: "#b3261e" },
    ]);

    addSectionTitle(doc, "Depots");
    addTable(doc, {
      head: ["Depot", "Role", "Stock (t)", "Capacity", "Inbound"],
      body: depots.map((d) => [d.name, d.role, d.stockTonnes.toLocaleString(), `${d.capacityPct}%`, d.inbound]),
      accentColor: activeCompany?.accentColor,
    });

    addSectionTitle(doc, "Stock by Cargo Type");
    addTable(doc, {
      head: ["Cargo", ...depots.map((d) => d.name), "Total", "Days Left", "Status"],
      body: stock.map((s) => [
        s.cargo,
        ...s.perDepot.map((p) => p.tonnes.toLocaleString()),
        s.total.toLocaleString(),
        s.daysLeft,
        s.statusLabel,
      ]),
      accentColor: activeCompany?.accentColor,
    });

    downloadReport(doc, `${activeCompany?.short || "Fleet"}-Depot-Report.pdf`);
  };

  if (error) {
    return (
      <div className="warehouse-dashboard">
        <LoadError label="Depot data" onRetry={retry} fullSection />
      </div>
    );
  }

  if (loading || !kpis || !holds) {
    return <div className="warehouse-dashboard"><div className="wh-loading">Loading warehouse data…</div></div>;
  }

  return (
    <div className="warehouse-dashboard">
      <div className="wh-header">
        <div>
          <div className="wh-eyebrow">Depot dashboard</div>
          <h1 className="wh-h1">{activeCompany?.name || "Fleet"}, depot overview</h1>
          <p className="wh-sub">Stock and dock activity across {depots.length} depots.</p>
        </div>
        <DownloadReportButton onGenerate={handleDownloadReport} label="Download PDF Report" />
      </div>

      <ErrorBoundary label="Depot">
        <section className="wh-section">
          <div className="wh-grid-4">
            <div className="wh-card wh-card--good">
              <div className="wh-label">In stock now</div>
              <div className="wh-num">{kpis.inStock.tonnes.toLocaleString()}</div>
              <div className="wh-card__sub">tonnes across all depots</div>
              <div className="wh-card__breakdown">
                {kpis.inStock.byCargo.map((c) => (
                  <div className="wh-card__breakdown-row" key={c.cargo}>
                    <span>{c.cargo}</span><span>{c.tonnes.toLocaleString()}t</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="wh-card wh-card--info">
              <div className="wh-label">On the way to us</div>
              <div className="wh-num">{kpis.incoming.tonnes.toLocaleString()}</div>
              <div className="wh-card__sub">tonnes in {kpis.incoming.truckCount} trucks</div>
              <div className="wh-card__breakdown">
                {kpis.incoming.byCargo.map((c) => (
                  <div className="wh-card__breakdown-row" key={c.cargo}>
                    <span>{c.cargo}</span><span>{c.tonnes.toLocaleString()}t</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="wh-card wh-card--warn">
              <div className="wh-label">Going out today</div>
              <div className="wh-num">{kpis.outgoing.tonnes.toLocaleString()}</div>
              <div className="wh-card__sub">tonnes in {kpis.outgoing.orderCount} loads</div>
              <div className="wh-card__breakdown">
                {kpis.outgoing.byCargo.map((c) => (
                  <div className="wh-card__breakdown-row" key={c.cargo}>
                    <span>{c.cargo}</span><span>{c.tonnes.toLocaleString()}t</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="wh-card wh-card--bad">
              <div className="wh-label">Quality holds</div>
              <div className="wh-num">{kpis.qualityHolds.count}</div>
              <div className="wh-card__sub">{kpis.qualityHolds.needsInspection} need inspection</div>
            </div>
          </div>
        </section>

        <section className="wh-section wh-command-grid">

          <div className="wh-panel">
            <div className="wh-section__head">
              <h2 className="wh-h2">Depots</h2>
            </div>
            <div className="wh-depot-rail">
              {depots.map((d) => (
                <div className="wh-depot" key={d.name}>
                  <div className="wh-depot__top">
                    <span className={`wh-dot wh-dot--${d.capacityPct >= 90 ? "bad" : d.capacityPct >= 75 ? "warn" : "good"}`} />
                    <span className="wh-depot__name">{d.name}</span>
                  </div>
                  <div className="wh-depot__role">{d.role} · {d.dockCount} docks</div>
                  <Bar pct={d.capacityPct} tone={d.capacityPct >= 90 ? "bad" : d.capacityPct >= 75 ? "warn" : "good"} />
                  <div className="wh-depot__footer">
                    <span>{d.capacityPct}% full</span>
                    <span>{d.inbound} inbound</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="wh-panel">
            <div className="wh-section__head">
              <h2 className="wh-h2">Stock by product</h2>
            </div>
            <div className="wh-stockbars">
              {kpis.inStock.byCargo.map((c, i) => (
                <div key={c.cargo}>
                  <div className="wh-stockbar-top"><span>{c.cargo}</span><b>{c.tonnes.toLocaleString()}t</b></div>
                  <div className="wh-stockbar-track">
                    <div
                      className="wh-stockbar-fill"
                      style={{
                        width: `${Math.round((c.tonnes / kpis.inStock.tonnes) * 100)}%`,
                        background: i === 0 ? "var(--wh-good)" : "var(--wh-info)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="wh-section__head" style={{ marginTop: 22 }}>
              <h2 className="wh-h2">Deliveries coming in</h2>
            </div>
            <div className="wh-deliveries-toolbar">
              <input
                type="text"
                className="wh-deliveries-search"
                placeholder="Search vehicle, driver, depot…"
                value={deliverySearch}
                onChange={(e) => setDeliverySearch(e.target.value)}
              />
              <div className="wh-filter-pills">
                {[
                  { key: "all", label: "All" },
                  { key: "good", label: "On time" },
                  { key: "warn", label: "Late" },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`wh-filter-pill${deliveryStatusFilter === f.key ? " wh-filter-pill--active" : ""}`}
                    onClick={() => setDeliveryStatusFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="wh-list">
              {filteredIncoming.slice(0, 6).map((d) => (
                <div className="wh-row" key={d.vehicleId}>
                  <div className="wh-row__time">
                    <div className="wh-row__time-val">{d.minutesOut < 60 ? `${d.minutesOut}m` : `${Math.round(d.minutesOut / 60)}h`}</div>
                    <div className="wh-row__time-label">out</div>
                  </div>
                  <div className="wh-row__body">
                    <div className="wh-row__title">
                      {d.weight}t {d.cargo} → {d.destination}
                      {d.toMainHub && <span className="wh-pill wh-pill--info wh-row__hub-badge">Main hub</span>}
                    </div>
                    <div className="wh-row__meta">from {d.departure} · {d.vehicleId} · {d.driver}</div>
                  </div>
                  <Pill tone={d.status}>{d.statusLabel}</Pill>
                </div>
              ))}
              {incoming.length === 0 && <div className="wh-empty">No inbound deliveries right now.</div>}
              {incoming.length > 0 && filteredIncoming.length === 0 && (
                <div className="wh-empty">No deliveries match "{deliverySearch}".</div>
              )}
            </div>
          </div>

          <div className="wh-panel-stack">
            <div className="wh-panel">
              <h2 className="wh-h2">Quality holds</h2>
              <div className="wh-holds-grid">
                <div className="wh-holds-cell wh-tone-info">
                  <div className="wh-num wh-num--sm">{holds.underInspection}</div>
                  <div className="wh-holds-label">Inspecting</div>
                </div>
                <div className="wh-holds-cell wh-tone-warn">
                  <div className="wh-num wh-num--sm">{holds.rejected}</div>
                  <div className="wh-holds-label">Rejected</div>
                </div>
                <div className="wh-holds-cell wh-tone-good">
                  <div className="wh-num wh-num--sm">{holds.cleared}</div>
                  <div className="wh-holds-label">Cleared</div>
                </div>
              </div>
            </div>

            <div className="wh-panel">
              <h2 className="wh-h2">Going out today</h2>
              <div className="wh-dispatch-list">
                {outbound.map((o) => (
                  <div className="wh-dispatch-row" key={o.depot}>
                    <div className="wh-dispatch-row__top">
                      <span className="wh-dispatch-row__name">{o.depot}</span>
                      <span className="wh-card__sub">{o.orderCount} loads</span>
                    </div>
                    <Bar pct={o.progress} tone={o.status} />
                    <div className="wh-card__sub" style={{ marginTop: 4 }}>{o.statusLabel}</div>
                  </div>
                ))}
                {outbound.length === 0 && <div className="wh-empty">No outbound dispatch right now.</div>}
              </div>
            </div>
          </div>

        </section>

        <section className="wh-section">
          <div className="wh-section__head">
            <h2 className="wh-h2">Stock by cargo type</h2>
          </div>
          <div className="wh-table-card">
            <div className="wh-table-scroll">
              <table className="wh-table">
                <thead>
                  <tr>
                    <th>Cargo</th>
                    {depots.map((d) => <th key={d.name} className="wh-table__num">{d.name.split(",")[0].split(" ").slice(0, 2).join(" ")}</th>)}
                    <th className="wh-table__num">Total</th>
                    <th>Days left</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map((s) => (
                    <tr key={s.cargo}>
                      <td className="wh-table__product">{s.cargo}</td>
                      {s.perDepot.map((p) => <td key={p.depot} className="wh-table__num">{p.tonnes.toLocaleString()}</td>)}
                      <td className="wh-table__num wh-table__total">{s.total.toLocaleString()}</td>
                      <td>
                        <div className="wh-table__days">
                          <Bar pct={Math.min((s.daysLeft / 30) * 100, 100)} tone={s.status} />
                          <span className="wh-card__sub">{s.daysLeft} days</span>
                        </div>
                      </td>
                      <td><Pill tone={s.status}>{s.statusLabel}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {alerts.length > 0 && (
          <section className="wh-section">
            <h2 className="wh-h2">Needs your attention</h2>
            <div className="wh-alerts">
              {alerts.map((a, i) => (
                <div className={`wh-alert wh-alert--${a.severity}`} key={i}>
                  <div className={`wh-alert__icon wh-tone-${a.severity}`}>
                    {a.severity === "bad" ? "!" : "⚠"}
                  </div>
                  <div className="wh-alert__body">
                    <div className="wh-alert__title">{a.title}</div>
                    <div className="wh-alert__detail">{a.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </ErrorBoundary>
    </div>
  );
}
