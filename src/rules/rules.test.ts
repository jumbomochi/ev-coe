import { describe, expect, it } from "vitest";
import { exerciseForDate, rulesAt, type CurrentCar } from "./index";
import { unusedCoeMonths } from "./coeRebate";
import { grossArf } from "./arf";
import type { EmissionBand } from "./types";
import lta from "../fixtures/lta-car-cost-2026-09.json";
import bankRates from "../ui/config/bank-rates.json";

const rules = rulesAt("2026-10-31");

const baseCar: CurrentCar = {
  registrationDate: "2018-10-15",
  coeExpiryDate: "2028-10-14",
  coeExercise: { month: "2018-10", bidding: 1 },
  category: "A",
  arfPaid: 20000,
  quotaPremiumPaid: 26000,
};

describe("COE rebate (LTA worked example)", () => {
  it("counts full calendar months then leftover days at 30 per month", () => {
    expect(unusedCoeMonths("2013-01-02", "2015-06-05")).toBe(29.1);
  });

  it("pays QP × unused months / 120, rounded down: $16,897 → $4,097", () => {
    const car: CurrentCar = {
      ...baseCar,
      registrationDate: "2005-06-06",
      coeExpiryDate: "2015-06-05",
      coeExercise: { month: "2005-05", bidding: 2 },
      quotaPremiumPaid: 16897,
    };
    expect(rules.deregistrationValue(car, "2013-01-02").coeRebate).toBe(4097);
  });

  it("is zero once the COE has expired", () => {
    expect(rules.deregistrationValue(baseCar, "2028-10-20").coeRebate).toBe(0);
  });

  it("uses 60 months for a 5-year renewed COE", () => {
    const renewed: CurrentCar = { ...baseCar, coeExpiryDate: "2033-10-14", renewal: { termYears: 5 }, quotaPremiumPaid: 60000 };
    // 2028-10-14 → 2033-10-14 is exactly 60 months unused.
    expect(rules.deregistrationValue(renewed, "2028-10-14").coeRebate).toBe(60000);
  });

  it("caps a Cat E rebate at the same exercise's QP for the car's own category", () => {
    const catE: CurrentCar = { ...baseCar, category: "E", equivalentCategory: "A", quotaPremiumPaid: 30000, ownCategoryPremiumSameExercise: 24000 };
    const asA: CurrentCar = { ...baseCar, quotaPremiumPaid: 24000 };
    expect(rules.deregistrationValue(catE, "2026-10-31").coeRebate).toBe(rules.deregistrationValue(asA, "2026-10-31").coeRebate);
  });
});

describe("PARF", () => {
  const parfOn = (car: CurrentCar, date: string) => rules.deregistrationValue(car, date).parf;

  it.each([
    ["2023-10-15", 15000], // exactly 5 years: "not more than 5 years" → 75%
    ["2023-10-16", 14000], // above 5 years → 70%
    ["2027-10-15", 11000], // exactly 9 years → 55%
    ["2028-10-15", 10000], // exactly 10 years → 50%
    ["2028-10-16", 0], // more than 10 years → nil
  ])("pre-Feb-2023 schedule on %s pays %i on $20,000 ARF", (date, expected) => {
    expect(parfOn(baseCar, date)).toBe(expected);
  });

  it("is nil for a renewed COE", () => {
    expect(parfOn({ ...baseCar, renewal: { termYears: 10 } }, "2026-10-31")).toBe(0);
  });

  it("caps at $60,000 for COEs from the 2nd Feb 2023 to the 1st Feb 2026 exercise", () => {
    const car: CurrentCar = { ...baseCar, registrationDate: "2023-03-01", coeExercise: { month: "2023-02", bidding: 2 }, arfPaid: 100000 };
    expect(parfOn(car, "2026-10-31")).toBe(60000);
    expect(parfOn({ ...car, coeExercise: { month: "2023-02", bidding: 1 } }, "2026-10-31")).toBe(75000);
    expect(parfOn({ ...car, coeExercise: { month: "2026-02", bidding: 1 } }, "2026-10-31")).toBe(60000);
  });

  it("uses 30% down to 5%, capped at $30,000, from the 2nd Feb 2026 exercise", () => {
    const car: CurrentCar = { ...baseCar, registrationDate: "2026-03-01", coeExercise: { month: "2026-02", bidding: 2 }, arfPaid: 50000 };
    expect(parfOn(car, "2031-03-01")).toBe(15000); // 5 years → 30%
    expect(parfOn(car, "2036-03-01")).toBe(2500); // 10 years → 5%
    expect(parfOn({ ...car, arfPaid: 200000 }, "2027-01-01")).toBe(30000);
  });
});

describe("ARF", () => {
  it("applies the tiers for COEs from the 2nd Feb 2023 exercise", () => {
    const e = { month: "2026-10", bidding: 2 } as const;
    expect(grossArf(20000, e)).toBe(20000);
    expect(grossArf(30000, e)).toBe(34000);
    expect(grossArf(100000, e)).toBe(200000); // 20k + 28k + 38k + 50k + 64k
  });

  it("applies the older tiers before that", () => {
    expect(grossArf(60000, { month: "2018-10", bidding: 1 })).toBe(80000); // 20k + 42k + 18k
  });

  it("offsets an EV's ARF with EEAI and VES in 2026, with no minimum ARF", () => {
    const ev = rules.newCarArf({ omv: 30000, band: "A", electric: true, registrationDate: "2026-11-15" });
    expect(ev).toMatchObject({ grossArf: 34000, eeai: 7500, vesRebate: 22500, netArf: 4000, assumed: false });
  });

  it("drops EEAI and lowers the VES rebate in 2027", () => {
    const ev = rules.newCarArf({ omv: 30000, band: "A", electric: true, registrationDate: "2027-03-01" });
    expect(ev).toMatchObject({ eeai: 0, vesRebate: 20000, netArf: 14000 });
  });

  it("charges surcharges separately and keeps a $5,000 minimum ARF for non-EVs", () => {
    const c1 = rules.newCarArf({ omv: 30000, band: "C1", electric: false, registrationDate: "2026-11-15" });
    expect(c1).toMatchObject({ netArf: 34000, vesSurcharge: 7500 });
    const cheap = rules.newCarArf({ omv: 10000, band: "A", electric: false, registrationDate: "2026-11-15" });
    expect(cheap.netArf).toBe(5000);
  });

  it("flags rules after 2027 as assumed", () => {
    expect(rules.newCarArf({ omv: 30000, band: "A", electric: true, registrationDate: "2028-06-01" }).assumed).toBe(true);
  });

  it("gives a new car PARF on its net ARF under the 2026 schedule", () => {
    const car = { omv: 30000, band: "B" as const, electric: false, registrationDate: "2026-11-15" };
    const arf = rules.newCarArf(car).netArf; // 34,000
    expect(rules.newCarParf(car, arf, "2036-11-15")).toBe(1700); // 10 years → 5%
  });
});

describe("ARF, VES and EEAI against LTA's Sep 2026 car-cost table (every model)", () => {
  const sep = rulesAt("2026-09-15");
  // LTA splits this car's $23,048 of rebates as VES $22,497 + EEAI $551 (we get $22,500 + $548).
  // Net ARF, which PARF uses, is $0 either way; only the split differs.
  const SPLIT_DIFFERS = new Set(["GAC AION UT PREMIUM"]);

  it.each(lta.rows.map((r) => [r.model, r]))("%s", (model, row) => {
    const out = sep.newCarArf({
      omv: row.omv,
      band: row.band as EmissionBand,
      electric: row.fuel === "E",
      registrationDate: "2026-09-15",
      coeExercise: { month: "2026-09", bidding: 1 },
    });
    const ltaNet = row.arf + Math.min(row.ves, 0) - Math.abs(row.eeai);
    expect({ arf: out.grossArf, net: out.netArf, surcharge: out.vesSurcharge }).toEqual({ arf: row.arf, net: ltaNet, surcharge: Math.max(row.ves, 0) });
    if (!SPLIT_DIFFERS.has(model)) {
      expect({ vesRebate: out.vesRebate, eeai: out.eeai }).toEqual({ vesRebate: Math.max(-row.ves, 0), eeai: Math.abs(row.eeai) });
    }
  });
});

describe("COE renewal", () => {
  it("costs PQP for 10 years and half PQP rounded up for 5 years", () => {
    expect(rules.renewalOptions(baseCar, 100001)).toEqual([
      { termYears: 10, cost: 100001 },
      { termYears: 5, cost: 50001 },
    ]);
  });

  it("allows no further renewal after a 5-year renewal", () => {
    expect(rules.renewalOptions({ ...baseCar, renewal: { termYears: 5 } }, 100000)).toEqual([]);
  });

  it("renews a Cat E car under its A/B equivalent", () => {
    expect(rules.renewalCategory({ ...baseCar, category: "E", equivalentCategory: "B" })).toBe("B");
    expect(() => rules.renewalCategory({ ...baseCar, category: "E" })).toThrow();
  });
});

describe("MAS car loans", () => {
  it("allows 70% of price at OMV up to $20,000 and 60% above", () => {
    expect(rules.maxLoan(150000, 20000)).toBe(105000);
    expect(rules.maxLoan(150000, 20001)).toBe(90000);
  });

  it("turns a flat rate into instalments and an effective rate", () => {
    const loan = rules.flatRateLoan(100000, 0.025, 60);
    expect(loan.totalInterestCents).toBe(1250000);
    expect(loan.monthlyInstalmentCents).toBe(187500);
    expect(loan.effectiveRate).toBeGreaterThan(0.045);
    expect(loan.effectiveRate).toBeLessThan(0.05);
  });

  it.each(bankRates.rates.map((r) => [r.lender, r]))("matches %s's published EIR", (_lender, r) => {
    const loan = rules.flatRateLoan(100000, r.flatRate, r.publishedEir.tenureMonths);
    expect(Math.round(loan.effectiveRate * 10000) / 10000).toBe(r.publishedEir.rate);
  });

  it("rejects tenures beyond 7 years", () => {
    expect(() => rules.flatRateLoan(100000, 0.025, 85)).toThrow();
  });
});

describe("exerciseForDate", () => {
  it("maps the first half of a month to the 1st exercise", () => {
    expect(exerciseForDate("2026-02-10")).toEqual({ month: "2026-02", bidding: 1 });
    expect(exerciseForDate("2026-02-20")).toEqual({ month: "2026-02", bidding: 2 });
  });
});

describe("road tax surcharge (OneMotoring table)", () => {
  const rules = rulesAt("2026-11-07");
  it("starts at 10% once a car is more than 10 years old and stops rising at 50% past 14", () => {
    expect([9.9, 10, 10.01, 11.5, 12.5, 13.5, 14.01, 20].map((a) => rules.roadTaxSurcharge(a))).toEqual([0, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.5]);
  });
});
