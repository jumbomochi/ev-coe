import { describe, expect, it } from "vitest";
import { rulesAt } from "../rules/index";
import { backtest, type BacktestInput, type Strip } from "./backtest";
import type { CoeResult } from "./data";

/** Synthetic premium history: every exercise Jan 2010 – Dec 2026, Cat A, premium from `price(month)`. */
function history(price: (month: string) => number): CoeResult[] {
  const rows: CoeResult[] = [];
  for (let y = 2010; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const month = `${y}-${String(m).padStart(2, "0")}`;
      for (const bidding of [1, 2] as const) {
        rows.push({ month, bidding, category: "A", quota: 1000, bidsSuccess: 1000, bidsReceived: 1200, premium: price(month) });
      }
    }
  }
  return rows;
}

// Reference new car: OMV $30,000, band B, non-electric → net ARF $34,000 under 2026 rules.
// Old car: ARF $20,000 on the pre-Feb-2023 PARF schedule, QP $30,000.
const base: Omit<BacktestInput, "coe"> = {
  rules: rulesAt("2026-11-15"),
  category: "A",
  newCar: { omv: 30000, band: "B", electric: false },
  oldCar: { arfPaid: 20000, quotaPremiumPaid: 30000, coeExercise: { month: "2016-10", bidding: 1 } },
};

const at = (s: Strip | undefined, month: string, bidding: 1 | 2) => s?.outcomes.find((o) => o.start.month === month && o.start.bidding === bidding)?.value;
const byPlan = (strips: Strip[], plan: Strip["plan"]) => strips.find((s) => s.plan === plan);

describe("backtest (hand-computed, flat $100,000 premiums, start Jun 2015 1st exercise)", () => {
  const strips = backtest({ ...base, coe: history(() => 100000) });

  it("buy at deadline: (100,000 + 34,000 − 10,000 old PARF − 1,700 new-car PARF at 10 yrs) ÷ 10", () => {
    expect(at(byPlan(strips, "buy-at-deadline"), "2015-06", 1)).toBe(12230);
  });

  it("renew 5 then buy: 50,000 + 134,000 − 10,200 PARF (5 yrs, 30%) − 50,000 COE left, vs buy at deadline", () => {
    expect(at(byPlan(strips, "renew-5-then-buy"), "2015-06", 1)).toBe(150);
  });

  it("buy a year early: 134,000 − 11,000 PARF (age 9, 55%) − 3,000 COE rebate (12 months) − 1,700, vs buy at deadline", () => {
    expect(at(byPlan(strips, "buy-a-year-early"), "2015-06", 1)).toBe(-400);
  });

  it("uses only start points with every price in the data: Jan 2011 – Dec 2021", () => {
    const s = byPlan(strips, "buy-at-deadline")!;
    expect(s.outcomes[0]!.start).toEqual({ month: "2011-01", bidding: 1 });
    expect(s.outcomes.at(-1)!.start).toEqual({ month: "2021-12", bidding: 2 });
    expect(s.n).toBe(11 * 24);
    expect(new Set(strips.map((x) => x.n)).size).toBe(1);
  });

  it("marks Cat A windows that span the Feb 2014 power-criterion change", () => {
    const s = byPlan(strips, "buy-at-deadline")!;
    expect(s.outcomes.find((o) => o.start.month === "2011-01")!.crossesBoundary).toBe(true);
    expect(s.outcomes.find((o) => o.start.month === "2015-06")!.crossesBoundary).toBe(false);
    expect(s.boundaryCrossings).toBeGreaterThan(0);
  });
});

describe("backtest sensitivity", () => {
  it("weights the post-wait premium P(t+5y) by half: +$50,000 at t+5y adds $2,500/yr to the renew plan", () => {
    const strips = backtest({ ...base, coe: history((m) => (m >= "2019-01" ? 150000 : 100000)) });
    expect(at(byPlan(strips, "buy-at-deadline"), "2015-06", 1)).toBe(12230);
    expect(at(byPlan(strips, "renew-5-then-buy"), "2015-06", 1)).toBe(2650);
  });

  it("hides the renew plan for a car already on a 5-year renewal", () => {
    const strips = backtest({ ...base, coe: history(() => 100000), oldCar: { ...base.oldCar!, renewal: { termYears: 5 } } });
    expect(strips.map((s) => s.plan)).toEqual(["buy-at-deadline", "buy-a-year-early"]);
  });

  it("gives no old-car PARF to a 10-year renewed car", () => {
    const renewed = backtest({ ...base, coe: history(() => 100000), oldCar: { ...base.oldCar!, renewal: { termYears: 10 } } });
    // Without the $10,000 old PARF the deadline plan costs $1,000/yr more.
    expect(at(byPlan(renewed, "buy-at-deadline"), "2015-06", 1)).toBe(13230);
  });

  it("gives a first-car buyer one absolute strip: (100,000 + 34,000 − 1,700) ÷ 10", () => {
    const strips = backtest({ ...base, oldCar: undefined, coe: history(() => 100000) });
    expect(strips.map((s) => [s.plan, s.relative])).toEqual([["first-car", false]]);
    expect(at(strips[0], "2015-06", 1)).toBe(13230);
  });
});
