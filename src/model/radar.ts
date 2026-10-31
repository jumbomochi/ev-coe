/**
 * COE supply radar (design doc section 2; T1 results). Cars come back to the COE pool as their
 * 10-year COEs expire, unless the owner renews. Since Feb 2023 LTA sets each quarter's car quota
 * at 25% of the previous 12 months' deregistrations, plus or minus its own adjustments
 * (COEs brought forward 2023-25, the ~20k injection, the 2026+ payback). We model the formula
 * part and show the adjustments as the gap to actual quotas; we do not forecast them.
 *
 *   registrations(m − 120) × (1 − renewal share)  →  expected deregistrations(m)
 *   0.25 × Σ deregistrations over the 12 months ending 2 months before the quarter  →  formula quota
 *
 * Cat A and Cat B each follow the formula on their own deregistrations (checked 2023-26: both sit
 * at the same ratio to it as the total). Cat E, open to either, takes about a tenth of the car
 * quota out of both, so a single category's actual quota runs below its formula line.
 *
 * Not included (stated on the chart): returns from 5-year renewals (year 15), 10-year renewals
 * (year 20) and early deregistrations.
 */
import type { CoeResult, MonthlyCount, Revalidation } from "./data";

export type SupplyCategory = "A" | "B";
const FORMULA_SHARE = 0.25;
/** Quarters start in Feb, May, Aug and Nov; LTA counts deregistrations up to 2 months before. */
const QUARTER_START_MONTHS = ["02", "05", "08", "11"];
const FORMULA_LAG_MONTHS = 2;
/** Months of recent history the renewal-share band is drawn from. */
const SHARE_WINDOW = 24;

export interface Band {
  low: number;
  mid: number;
  high: number;
}

export interface RadarMonth {
  month: string;
  /** Cars registered 10 years earlier, i.e. reaching 10 years this month. */
  expiringCohort?: number;
  actualDeregistrations?: number;
  renewals?: number;
  /** Expected deregistrations = cohort × (1 − renewal share band). */
  expectedDeregistrations?: Band;
}

export interface RadarQuarter {
  quarterStart: string;
  /** Actual quota across the quarter's exercises (Cat A+B+E, or the one category), if published. */
  actualQuota?: number;
  /** Formula quota using actual deregistrations where known, expected ones after. */
  formulaQuota?: Band;
  /** True when every month in the 12-month window is already actual. */
  formulaFromActuals: boolean;
}

export interface Radar {
  months: RadarMonth[];
  quarters: RadarQuarter[];
  renewalShare: Band & { fromMonth: string; toMonth: string };
  hindcast: {
    /** Mean |expected − actual| / actual deregistrations, over months where both exist. */
    cohortModelError: number;
    cohortModelMonths: number;
  };
}

export function addMonths(month: string, k: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function monthlyCars(rows: { month: string; category: string; number: number }[], categories: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) if (categories.has(r.category)) out.set(r.month, (out.get(r.month) ?? 0) + r.number);
  return out;
}

function quantile(sorted: number[], f: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(f * sorted.length) - 1))]!;
}

export function radar(input: {
  registrations: MonthlyCount[];
  deregistrations: MonthlyCount[];
  revalidations: Revalidation[];
  coe: CoeResult[];
  /** Last month to project to. */
  untilMonth: string;
  /** One COE category's supply; all cars (Cat A+B, quota A+B+E) when omitted. */
  category?: SupplyCategory;
}): Radar {
  const cats = new Set(input.category ? [`Category ${input.category}`] : ["Category A", "Category B"]);
  const quotaCats = new Set(input.category ? [input.category] : ["A", "B", "E"]);
  const reg = monthlyCars(input.registrations, cats);
  const dereg = monthlyCars(input.deregistrations, cats);
  const reval = monthlyCars(input.revalidations, cats);
  const cohort = (m: string) => reg.get(addMonths(m, -120));

  // Renewal share: revalidations ÷ expiring cohort, over the latest SHARE_WINDOW months with both.
  const shareMonths = [...reval.keys()].filter((m) => cohort(m)).sort().slice(-SHARE_WINDOW);
  if (shareMonths.length === 0) throw new Error("No months with both revalidations and a 10-year-old cohort");
  const shares = shareMonths.map((m) => reval.get(m)! / cohort(m)!).sort((a, b) => a - b);
  const share = { low: quantile(shares, 0.25), mid: quantile(shares, 0.5), high: quantile(shares, 0.75) };

  const firstMonth = [...reg.keys(), ...dereg.keys()].sort()[0]!;
  const months: RadarMonth[] = [];
  for (let m = firstMonth; m <= input.untilMonth; m = addMonths(m, 1)) {
    const c = cohort(m);
    months.push({
      month: m,
      expiringCohort: c,
      actualDeregistrations: dereg.get(m),
      renewals: reval.get(m),
      // Higher renewal share → fewer cars come back, so `high` returns use the `low` share.
      expectedDeregistrations: c === undefined ? undefined : { low: c * (1 - share.high), mid: c * (1 - share.mid), high: c * (1 - share.low) },
    });
  }
  const byMonth = new Map(months.map((r) => [r.month, r]));

  const quotaByMonth = new Map<string, number>();
  for (const r of input.coe) {
    if (quotaCats.has(r.category)) quotaByMonth.set(r.month, (quotaByMonth.get(r.month) ?? 0) + r.quota);
  }

  const quarters: RadarQuarter[] = [];
  for (const row of months) {
    if (!QUARTER_START_MONTHS.includes(row.month.slice(5))) continue;
    const window = Array.from({ length: 12 }, (_, i) => addMonths(row.month, -FORMULA_LAG_MONTHS - i));
    let formula: Band | undefined = { low: 0, mid: 0, high: 0 };
    let allActual = true;
    for (const m of window) {
      const actual = dereg.get(m);
      const expected = byMonth.get(m)?.expectedDeregistrations;
      if (actual !== undefined) {
        formula.low += actual;
        formula.mid += actual;
        formula.high += actual;
      } else if (expected) {
        allActual = false;
        formula.low += expected.low;
        formula.mid += expected.mid;
        formula.high += expected.high;
      } else {
        formula = undefined;
        break;
      }
    }
    const quarterMonths = [0, 1, 2].map((k) => addMonths(row.month, k));
    const published = quarterMonths.every((m) => quotaByMonth.has(m));
    quarters.push({
      quarterStart: row.month,
      actualQuota: published ? quarterMonths.reduce((a, m) => a + quotaByMonth.get(m)!, 0) : undefined,
      formulaQuota: formula && { low: formula.low * FORMULA_SHARE, mid: formula.mid * FORMULA_SHARE, high: formula.high * FORMULA_SHARE },
      formulaFromActuals: formula !== undefined && allActual,
    });
  }

  const both = months.filter((r) => r.actualDeregistrations !== undefined && r.expectedDeregistrations !== undefined);
  const error = both.length
    ? both.reduce((a, r) => a + Math.abs(r.expectedDeregistrations!.mid - r.actualDeregistrations!) / r.actualDeregistrations!, 0) / both.length
    : NaN;

  return {
    months,
    quarters,
    renewalShare: { ...share, fromMonth: shareMonths[0]!, toMonth: shareMonths.at(-1)! },
    hindcast: { cohortModelError: error, cohortModelMonths: both.length },
  };
}
