/** Section 4: what each plan would have cost someone with your deadline, replayed on real COE history. */
import * as Plot from "@observablehq/plot";
import type { Strip } from "../model/backtest";
import { h, money, monthLabel, signedMoney } from "./dom";

const TITLES: Record<Strip["plan"], string> = {
  "buy-at-deadline": "Buy when your COE expires",
  "renew-5-then-buy": "Renew 5 years, then buy",
  "buy-a-year-early": "Buy a year early",
  "first-car": "Buy in your target month",
};

function stripChart(s: Strip, width: number): SVGSVGElement | HTMLElement {
  const data = s.outcomes.map((o, i) => ({ ...o, label: `${monthLabel(o.start.month)} (${o.start.bidding === 1 ? "1st" : "2nd"})`, jitter: ((i * 37) % 17) / 17 }));
  return Plot.plot({
    width,
    height: 92,
    marginLeft: 12,
    marginRight: 12,
    x: { label: s.relative ? "Cost per year vs buying at expiry →" : "Cost per year of road access →", tickFormat: (d: number) => (s.relative ? signedMoney(d) : money(d)) },
    y: { axis: null, domain: [0, 1] },
    style: { background: "transparent", color: "var(--ink)", fontSize: "11px" },
    marks: [
      s.relative ? Plot.ruleX([0], { stroke: "var(--muted)" }) : null,
      Plot.ruleY([0.5], { x1: s.p10, x2: s.p90, stroke: "var(--accent)", strokeWidth: 10, strokeOpacity: 0.15 }),
      Plot.dot(data, {
        x: "value",
        y: (d) => 0.2 + d.jitter * 0.6,
        r: 2.2,
        stroke: "var(--ink)",
        fill: (d) => (d.crossesBoundary ? "none" : "var(--ink)"),
        fillOpacity: 0.55,
        title: (d) => `Deadline ${d.label}: ${s.relative ? signedMoney(d.value) : money(d.value)} a year${d.crossesBoundary ? " (spans a COE category rule change)" : ""}`,
      }),
      Plot.tickX([s.median], { stroke: "var(--accent)", strokeWidth: 3 }),
    ].filter(Boolean) as Plot.Markish[],
  });
}

export function plansSection(strips: Strip[], width: number, referenceLabel: string): HTMLElement {
  const first = strips[0];
  const span = first && first.outcomes.length ? `${monthLabel(first.outcomes[0]!.start.month)} – ${monthLabel(first.outcomes.at(-1)!.start.month)}` : "";
  return h(
    "div",
    {},
    h(
      "p",
      { class: "lede" },
      first?.plan === "first-car"
        ? "What buying in a given month has cost over 10 years of driving, for every bidding exercise in the record."
        : "Each dot treats one past bidding exercise as your COE expiry date and replays the plan on the premiums people actually paid.",
    ),
    ...strips.map((s) =>
      h(
        "section",
        { class: "strip" },
        h("h3", {}, TITLES[s.plan]),
        h(
          "p",
          { class: "sub" },
          s.relative ? `Median ${signedMoney(s.median)} a year vs buying at expiry` : `Median ${money(s.median)} a year`,
          ` · 10–90%: ${s.relative ? signedMoney(s.p10) : money(s.p10)} to ${s.relative ? signedMoney(s.p90) : money(s.p90)} · N = ${s.n}`,
          s.boundaryCrossings ? ` · ${s.boundaryCrossings} of ${s.n} windows span a COE category rule change (hollow)` : "",
        ),
        h("figure", { class: "chart" }, stripChart(s, width)),
      ),
    ),
    h(
      "p",
      { class: "note" },
      `This shows what happened, not what will happen. ${first?.plan === "first-car" ? "Buying months" : "Deadlines"} from ${span}. Windows overlap in time, so the dots are not independent trials. `,
      `Costs are COE premiums and PQP, plus the next car's ARF less the PARF it keeps (reference car: ${referenceLabel}), per year of road access, in nominal dollars, with today's rules applied to past prices. They exclude the car's price and depreciation, VES/EEAI timing, fuel and insurance.`,
    ),
  );
}
