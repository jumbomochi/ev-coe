import { describe, expect, it } from "vitest";
import { addYears, rulesAt, type CurrentCar } from "../rules/index";
import { radar } from "../model/radar";
import { data } from "./data";
import { buyPoints, decide, newCarCost, supplyAt, switchDates, yearsBetween } from "./decision";
import { defaultNextCar, nextCarFigures } from "./nextCar";

const TODAY = "2026-11-07";
const rules = rulesAt(TODAY);
const car: CurrentCar = {
  registrationDate: "2018-10-15",
  coeExpiryDate: "2028-10-14",
  coeExercise: { month: "2018-10", bidding: 1 },
  category: "A",
  arfPaid: 20000,
  quotaPremiumPaid: 26000,
};
const hrv = { ...defaultNextCar(), presetId: "honda-hrv-15-dx-sin" };
const atto3 = { ...defaultNextCar(), presetId: "byd-atto-3-evo-dynamic" };

describe("switchDates", () => {
  it("runs monthly on the expiry's day, from today to the expiry date", () => {
    const d = switchDates(TODAY, car.coeExpiryDate);
    expect(d.slice(0, 3)).toEqual([TODAY, "2026-11-14", "2026-12-14"]);
    expect(d.at(-1)).toBe("2028-10-14");
    expect(d).toHaveLength(25);
  });
});

describe("newCarCost", () => {
  it("is today's price less the resale floor when bought today", () => {
    const f = nextCarFigures(hrv, rules, TODAY);
    expect(newCarCost(hrv, rules, TODAY, TODAY)).toMatchObject({ price: f.price, arfChange: 0, resale: f.floor, cost: f.price! - f.floor });
  });

  it("moves the price with the ARF rules in force on the purchase date", () => {
    // 2027: the EEAI ends and the band A VES rebate drops from $22,500 to $20,000.
    const later = newCarCost(atto3, rules, TODAY, "2027-03-01")!;
    const f = nextCarFigures(atto3, rules, TODAY);
    expect(later.arfChange).toBeGreaterThan(0);
    expect(later.price).toBe(f.price! + later.arfChange);
    expect(later.assumed).toBe(false);
    expect(newCarCost(atto3, rules, TODAY, "2028-03-01")!.assumed).toBe(true);
  });

  it("is undefined for a car with no price", () => {
    expect(newCarCost({ ...defaultNextCar(), presetId: "jaecoo-6-ev" }, rules, TODAY, TODAY)).toBeUndefined();
  });
});

describe("decide", () => {
  const d = decide(car, hrv, rules, TODAY, 129883);

  it("switching today gives up nothing; later switches give up the payback that runs down", () => {
    expect(d.points[0]!.waitCost).toBe(0);
    expect(d.points.at(-1)!.waitCost).toBe(d.points[0]!.payback - rules.deregistrationValue(car, car.coeExpiryDate).total);
  });

  it("spreads each plan's cost over its years of road access", () => {
    const p = d.points.at(-1)!;
    expect(p.perYear).toBeCloseTo((p.waitCost + p.newCar!.cost) / (yearsBetween(TODAY, car.coeExpiryDate) + 10), 6);
    const r5 = d.renewals.find((r) => r.termYears === 5)!;
    expect(r5).toMatchObject({ renewalCost: 64942, until: addYears(car.coeExpiryDate, 5) });
    expect(r5.perYear).toBeCloseTo((d.points[0]!.payback + 64942 + r5.newCar!.cost) / (yearsBetween(TODAY, r5.until) + 10), 6);
  });

  it("picks the cheapest plan per year", () => {
    const all = [...d.points.map((p) => p.perYear!), ...d.renewals.map((r) => r.perYear!)];
    const best = d.best!.kind === "switch" ? d.best!.point.perYear : d.best!.plan.perYear;
    expect(best).toBe(Math.min(...all));
  });

  it("offers no renewal for a car already on a 5-year renewal", () => {
    expect(decide({ ...car, renewal: { termYears: 5 } }, hrv, rules, TODAY, 129883).renewals).toEqual([]);
  });

  it("still gives paybacks, but no costs or verdict, when the next car has no price", () => {
    const n = decide(car, { ...defaultNextCar(), presetId: "jaecoo-6-ev" }, rules, TODAY, 129883);
    expect(n.points[0]!.payback).toBeGreaterThan(0);
    expect(n.best).toBeUndefined();
  });
});

describe("buyPoints", () => {
  it("prices a first car month by month for three years", () => {
    const pts = buyPoints(hrv, rules, TODAY);
    expect(pts).toHaveLength(37);
    expect(pts[0]!.perYear).toBeCloseTo(pts[0]!.newCar!.cost / 10, 6);
  });
});

describe("supplyAt", () => {
  const r = radar({ registrations: data.registrations.rows, deregistrations: data.deregistrations.rows, revalidations: data.revalidations.rows, coe: data.coe.rows, untilMonth: "2030-12", category: "A" });
  it("reads the formula quota of the quarter containing the date", () => {
    const s = supplyAt(r, "2027-06-20")!;
    expect(s.quarterStart).toBe("2027-05");
    expect(s.quota).toBe(Math.round(r.quarters.find((q) => q.quarterStart === "2027-05")!.formulaQuota!.mid));
  });
});
