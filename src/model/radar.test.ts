import { describe, expect, it } from "vitest";
import { addMonths, radar } from "./radar";
import type { CoeResult, MonthlyCount, Revalidation } from "./data";

function months(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

const count = (ms: string[], n: (m: string) => number, category = "Category A"): MonthlyCount[] => ms.map((month) => ({ month, category, number: n(month) }));

// Registrations from 2014; every cohort is 1,000 cars except a 3,000-car wave in 2017.
const registrations = [
  ...count(months("2014-01", "2026-09"), (m) => (m.startsWith("2017") ? 3000 : 1000)),
  ...count(months("2014-01", "2026-09"), () => 50, "Taxis"),
];
// From 2024 a quarter of each expiring cohort renews; the rest deregister.
const revalidations: Revalidation[] = months("2024-01", "2026-08").map((month) => ({ month, termYears: 10, category: "Category A", number: 250 }));
const deregistrations = count(months("2014-01", "2026-09"), (m) => (m >= "2024-01" ? 750 : 1000));
const coe: CoeResult[] = months("2025-11", "2026-01").flatMap((month) =>
  ([1, 2] as const).map((bidding) => ({ month, bidding, category: "A" as const, quota: 1000, bidsSuccess: 1, bidsReceived: 1, premium: 1 })),
);

const r = radar({ registrations, deregistrations, revalidations, coe, untilMonth: "2028-12" });

describe("radar", () => {
  it("shifts registrations forward 10 years and ignores non-car categories", () => {
    expect(r.months.find((m) => m.month === "2027-03")!.expiringCohort).toBe(3000);
    expect(r.months.find((m) => m.month === "2026-03")!.expiringCohort).toBe(1000);
  });

  it("estimates the renewal share from recent revalidations ÷ expiring cohort", () => {
    expect(r.renewalShare).toMatchObject({ low: 0.25, mid: 0.25, high: 0.25, toMonth: "2026-08" });
  });

  it("expects the 2017 wave to return as 75% of its cohort in 2027", () => {
    expect(r.months.find((m) => m.month === "2027-06")!.expectedDeregistrations).toEqual({ low: 2250, mid: 2250, high: 2250 });
  });

  it("sets the formula quota at 25% of the 12 months of deregistrations ending 2 months before the quarter", () => {
    const nov25 = r.quarters.find((q) => q.quarterStart === "2025-11")!;
    // Window Sep 2024 – Sep 2025: all actual, 750 a month.
    expect(nov25.formulaFromActuals).toBe(true);
    expect(nov25.formulaQuota!.mid).toBe(0.25 * 12 * 750);
    expect(nov25.actualQuota).toBe(6000);
  });

  it("blends actual and expected months, then rises with the 2017 wave", () => {
    const feb28 = r.quarters.find((q) => q.quarterStart === "2028-02")!;
    // Window Jan – Dec 2027: all expected, 2,250 a month.
    expect(feb28.formulaFromActuals).toBe(false);
    expect(feb28.formulaQuota!.mid).toBe(0.25 * 12 * 2250);
    expect(r.quarters.find((q) => q.quarterStart === "2026-11")!.actualQuota).toBeUndefined();
  });

  it("reports the cohort model's error against actual deregistrations", () => {
    // From 2024 the model expects 1,000 × 0.75 = 750 a month, exactly the actuals.
    expect(r.hindcast.cohortModelError).toBe(0);
    expect(r.hindcast.cohortModelMonths).toBe(months("2024-01", "2026-09").length);
  });
});

describe("radar by category (real DataMall snapshot)", async () => {
  const { data } = await import("../ui/data");
  const input = { registrations: data.registrations.rows, deregistrations: data.deregistrations.rows, revalidations: data.revalidations.rows, coe: data.coe.rows, untilMonth: "2030-12" };
  const all = radar(input);
  const a = radar({ ...input, category: "A" });
  const b = radar({ ...input, category: "B" });
  const at = (x: typeof all, q: string) => x.quarters.find((r) => r.quarterStart === q)!;

  it("splits the formula exactly where it comes from actual deregistrations", () => {
    const q = all.quarters.filter((r) => r.formulaFromActuals && r.quarterStart >= "2023-02");
    expect(q.length).toBeGreaterThan(10);
    for (const r of q) expect(at(a, r.quarterStart).formulaQuota!.mid + at(b, r.quarterStart).formulaQuota!.mid).toBeCloseTo(r.formulaQuota!.mid, 6);
  });

  it("reports each category's own actual quota, with Cat E only in the total", () => {
    const q = "2026-08";
    const quota = (cat: string) => data.coe.rows.filter((r) => r.category === cat && r.month >= q && r.month <= "2026-10").reduce((s, r) => s + r.quota, 0);
    expect(at(a, q).actualQuota).toBe(quota("A"));
    expect(at(b, q).actualQuota).toBe(quota("B"));
    expect(at(all, q).actualQuota).toBe(quota("A") + quota("B") + quota("E"));
  });
});
