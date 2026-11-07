import { describe, expect, it } from "vitest";
import { addYears, rulesAt, type CurrentCar } from "../rules/index";
import { radar } from "../model/radar";
import { data, latestPremium } from "./data";
import { buyPoints, decide, newCarCost, supplyAt, switchDates, yearsBetween } from "./decision";
import { defaultNextCar, nextCarFigures, premiumAt, usedCarFigures } from "./nextCar";

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

describe("premium trend", () => {
  it("moves a new car's price, and its COE rebate floor, with the premium on the purchase date", () => {
    const rising = { ...hrv, premiumTrend: 0.05 };
    const change = premiumAt("A", TODAY, "2028-11-07", 0.05) - latestPremium("A");
    expect(change).toBeCloseTo(latestPremium("A") * (1.05 ** (731 / 365.25) - 1), -1);
    const c = newCarCost(rising, rules, TODAY, "2028-11-07")!;
    expect(c.premiumChange).toBe(change);
    expect(c.price).toBe(newCarCost(hrv, rules, TODAY, "2028-11-07")!.price + change);
  });

  it("scales the renewal cost by the premium change up to expiry", () => {
    const flat = decide(car, hrv, rules, TODAY, 129883);
    const rising = decide(car, { ...hrv, premiumTrend: 0.05 }, rules, TODAY, 129883);
    const growth = 1.05 ** yearsBetween(TODAY, car.coeExpiryDate);
    expect(rising.renewals[0]!.renewalCost).toBeCloseTo(flat.renewals[0]!.renewalCost * growth, -1);
  });

  it("says how much extra upkeep a renewed car could take before the cheapest switch wins", () => {
    const d = decide(car, hrv, rules, TODAY, 129883);
    expect(d.best?.kind).toBe("renew");
    const b = d.upkeepBreakEven!;
    const span = yearsBetween(TODAY, b.plan.until) + d.holdingYears;
    expect(b.perYear).toBeGreaterThan(0);
    expect(b.plan.perYear! + (b.perYear * b.plan.termYears) / span).toBeCloseTo(b.versus.perYear!, 6);
    expect(decide(car, { ...hrv, premiumTrend: 0.05 }, rules, TODAY, 129883).upkeepBreakEven).toBeUndefined();
  });
});

describe("used next car", () => {
  const used = { ...hrv, kind: "used" as const, usedYearsLeft: 5 };

  it("prices the COE left at today's premium, plus the PARF to come and what's left of the car", () => {
    const u = usedCarFigures(used, rules, TODAY, TODAY);
    expect(u.car).toMatchObject({ registrationDate: "2021-11-08", coeExpiryDate: "2031-11-07", arfPaid: 16722 });
    expect(u.value!.coeLeft).toBe(Math.round(latestPremium("A") / 2));
    expect(u.value!.parf).toBe(Math.round(16722 * 0.5));
    expect(u.value!.bodyLow).toBeLessThan(u.value!.bodyHigh);
    expect(u.value!.low).toBe(u.value!.coeLeft + u.value!.parf + u.value!.bodyLow);
    expect(u.price).toBe(Math.round((u.value!.low + u.value!.high) / 2));
    expect(u.resale).toBe(u.value!.parf);
  });

  it("gives a renewed car no PARF and a range from its paper value to the COE left", () => {
    const u = usedCarFigures({ ...used, usedRenewed: true }, rules, TODAY, TODAY);
    expect(u.car.renewal).toEqual({ termYears: 10 });
    expect(u.resale).toBe(0);
    expect(u.value).toMatchObject({ low: u.value!.paperNow, high: u.value!.coeLeft, bodyHigh: 0 });
  });

  it("moves a typed asking price with the premium when bought later", () => {
    const typed = { ...used, usedPrice: "95,000", premiumTrend: 0.05 };
    const later = usedCarFigures(typed, rules, TODAY, "2028-11-07");
    expect(usedCarFigures(typed, rules, TODAY, TODAY)).toMatchObject({ price: 95000, priceBasis: "asking" });
    expect(later.price).toBe(95000 + Math.round((later.premium * 5) / 10) - Math.round((latestPremium("A") * 5) / 10));
  });

  it("spreads the cost over the COE it has left", () => {
    const c = newCarCost(used, rules, TODAY, TODAY)!;
    expect(c).toMatchObject({ years: 5, cost: c.price - c.resale });
    expect(decide(car, used, rules, TODAY, 129883).holdingYears).toBe(5);
    expect(buyPoints(used, rules, TODAY)[0]!.perYear).toBeCloseTo(c.cost / 5, 6);
  });

  it("can't be priced without a new price or an asking price", () => {
    expect(newCarCost({ ...used, presetId: "jaecoo-6-ev" }, rules, TODAY, TODAY)).toBeUndefined();
    expect(newCarCost({ ...used, presetId: "jaecoo-6-ev", usedPrice: "60000" }, rules, TODAY, TODAY)!.price).toBe(60000);
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
