/** Section 2: COE supply in your window. */
import * as Plot from "@observablehq/plot";
import type { Radar, SupplyCategory } from "../model/radar";
import { h, method, monthLabel, source } from "./dom";
import markers from "./config/markers.json";

/** First quarter set by the 12-month formula (LTA, Feb 2023). */
const FORMULA_SINCE = "2023-02";
const toDate = (month: string) => new Date(`${month}-01T00:00:00Z`);
const isoToDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

export type SupplyView = SupplyCategory | "all";

export function supplySection(
  radars: Record<SupplyView, Radar>,
  view: SupplyView,
  onView: (v: SupplyView) => void,
  window: { from: string; to: string } | undefined,
  width: number,
): HTMLElement {
  const radar = radars[view];
  const what = view === "all" ? "car COEs" : `Cat ${view} COEs`;
  const quarters = radar.quarters.filter((q) => q.quarterStart >= "2018-02");
  const projected = quarters.filter((q) => q.formulaQuota && !q.formulaFromActuals);
  // LTA has used the 12-month formula since Feb 2023; before that, quotas followed the previous quarter.
  const formula = quarters.filter((q) => q.formulaQuota && q.quarterStart >= FORMULA_SINCE).map((q) => ({ date: toDate(q.quarterStart), ...q.formulaQuota!, projected: !q.formulaFromActuals }));
  // The projection starts from the last quarter computed from actual data, so the two lines join.
  const split = formula.findIndex((d) => d.projected);
  const fromActuals = split === -1 ? formula : formula.slice(0, split);
  const projection = split === -1 ? [] : formula.slice(Math.max(0, split - 1));
  const actual = quarters.filter((q) => q.actualQuota !== undefined).map((q) => ({ date: toDate(q.quarterStart), quota: q.actualQuota! }));
  const peak = projected.reduce((a, q) => (q.formulaQuota!.mid > (a?.formulaQuota!.mid ?? 0) ? q : a), projected[0]);
  const lastActual = actual.at(-1);
  const yMax = Math.max(...formula.map((d) => d.high), ...actual.map((d) => d.quota));

  const marks: Plot.Markish[] = [
    Plot.gridY({ strokeOpacity: 0.12 }),
    window ? Plot.rectX([window], { x1: (d) => isoToDate(d.from), x2: (d) => isoToDate(d.to), fill: "var(--accent)", fillOpacity: 0.1 }) : null,
    Plot.areaY(formula.filter((d) => d.projected), { x: "date", y1: "low", y2: "high", fill: "var(--accent)", fillOpacity: 0.18, curve: "step-after" }),
    Plot.lineY(fromActuals, { x: "date", y: "mid", stroke: "var(--accent)", strokeWidth: 2, curve: "step-after" }),
    Plot.lineY(projection, { x: "date", y: "mid", stroke: "var(--accent)", strokeWidth: 2, curve: "step-after", strokeDasharray: "4,3" }),
    Plot.dot(actual, { x: "date", y: "quota", r: 2.5, fill: "var(--ink)" }),
    Plot.ruleX(markers.policy, { x: (d) => isoToDate(d.date), stroke: "var(--muted)", strokeDasharray: "2,3", title: (d) => `${d.label}\n${d.detail}` }),
    Plot.ruleX(markers.tech, { x: (d) => isoToDate(d.date), y1: 0, y2: yMax * 0.12, stroke: "var(--warn)", strokeWidth: 3, title: (d) => `${d.label}\n${d.detail}` }),
    Plot.ruleY([0]),
  ].filter(Boolean) as Plot.Markish[];

  const chart = Plot.plot({
    width,
    height: 320,
    marginLeft: 56,
    x: { type: "utc", label: null },
    y: { label: view === "all" ? "Car COEs per quarter (Cat A+B+E)" : `Cat ${view} COEs per quarter`, grid: false, tickFormat: "~s" },
    style: { background: "transparent", color: "var(--ink)", fontSize: "12px" },
    marks,
  });

  const toggle = h(
    "div",
    { class: "toggle small", role: "radiogroup", "aria-label": "COE category" },
    ...(["A", "B", "all"] as const).map((v) =>
      h("button", { type: "button", role: "radio", "aria-checked": view === v ? "true" : "false", class: view === v ? "on" : "", onclick: () => onView(v) }, v === "all" ? "All cars" : `Cat ${v}`),
    ),
  );

  // Formula against formula: the actual quota sits below the formula by Cat E's share and LTA's adjustments.
  const current = formula.filter((d) => !d.projected).at(-1);
  const rise = peak && current ? Math.round((peak.formulaQuota!.mid / current.mid - 1) * 100) : undefined;

  return h(
    "div",
    {},
    h("p", { class: "kicker" }, "COE supply"),
    h(
      "h3",
      { class: "takeaway lede" },
      peak && rise !== undefined
        ? `${what[0]!.toUpperCase()}${what.slice(1)} are projected to peak at about ${Math.round(peak.formulaQuota!.mid).toLocaleString("en-SG")} a quarter in ${monthLabel(peak.quarterStart)}, ${rise > 0 ? `${rise}% above` : "level with"} this quarter.`
        : `Supply of ${what}`,
    ),
    toggle,
    h("p", { class: "sub" }, "Cars registered in the 2016-18 wave reach 10 years in 2026-28. More COEs come back, unless owners renew."),
    h("figure", { class: "chart" }, chart),
    h(
      "ul",
      { class: "legend" },
      h("li", {}, h("span", { class: "sw line" }), "Formula quota, in force since Feb 2023: 25% of the previous 12 months' deregistrations (solid = from actual data)"),
      h("li", {}, h("span", { class: "sw band" }), `Projection range: ${Math.round(radar.renewalShare.low * 100)}–${Math.round(radar.renewalShare.high * 100)}% of 10-year-old cars renewed (${monthLabel(radar.renewalShare.fromMonth)} – ${monthLabel(radar.renewalShare.toMonth)})`),
      h("li", {}, h("span", { class: "sw dot" }), "Actual quota per quarter"),
      h("li", {}, h("span", { class: "sw tick" }), "Solid-state battery targets"),
      h("li", {}, h("span", { class: "sw rule" }), "Policy dates (hover for details)"),
      window ? h("li", {}, h("span", { class: "sw window" }), "Your window") : null,
    ),
    method(
      h("p", {}, `Latest actual quota: ${lastActual ? lastActual.quota.toLocaleString("en-SG") : "—"} ${what} a quarter. Battery dates are company targets, not Singapore launch dates. Policy dates: ${markers.policy.map((m) => `${m.label} (${m.date})`).join("; ")}.`),
      h(
      "p",
      {},
      view === "all" ? "" : `Cat E takes about a tenth of the car quota out of both categories, so Cat ${view}'s actual quota sits below its formula line. `,
      view === "all" ? "The gap between the formula and actual quota is LTA's own adjustment:" : "The rest of the gap is LTA's own adjustment:",
      " COEs brought forward in 2023-25 and an extra ~20,000 from 2025 pushed quotas above the formula; from 2026 the brought-forward COEs are paid back, pulling them below it. ",
      `Not included: COEs returning from 5- and 10-year renewals or early deregistrations. Projecting deregistrations from 10-year-old cohorts has been off by ${Math.round(radar.hindcast.cohortModelError * 100)}% on average over the last ${radar.hindcast.cohortModelMonths} months.`,
    ),
    h(
      "p",
      {},
      "Data: LTA DataMall (COE results, registrations, deregistrations, revalidations). Quota method: ",
      source("https://www.lta.gov.sg/content/ltagov/en/newsroom/2026/10/news-releases/coe_quota_nov26-jan27.html", "LTA, 26 Oct 2026"),
      ". Peak figure is a projection, not a forecast of premiums.",
    ),
    ),
  );
}
