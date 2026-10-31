/** The committed DataMall snapshot (data/*.json), bundled at build time by scripts/fetch-data.ts output. */
// "@data" is data/ normally, and a frozen copy (e2e/fixtures/data) in the end-to-end test build.
import coeResults from "@data/coe-results.json";
import pqp from "@data/pqp.json";
import newRegistrations from "@data/new-registrations.json";
import deregistrations from "@data/deregistrations.json";
import revalidations from "@data/revalidations.json";
import type { CoeResult, Dataset, MonthlyCount, Pqp, Revalidation } from "../model/data";
import { PremiumHistory } from "../model/premiums";
import type { Exercise } from "../rules/index";

export const data = {
  coe: coeResults as Dataset<CoeResult>,
  pqp: pqp as Dataset<Pqp>,
  registrations: newRegistrations as Dataset<MonthlyCount>,
  deregistrations: deregistrations as Dataset<MonthlyCount>,
  revalidations: revalidations as Dataset<Revalidation>,
};

export const history = new PremiumHistory(data.coe.rows);

export function latestExercise(): Exercise {
  const last = data.coe.rows.reduce((a, r) => (r.month > a.month || (r.month === a.month && r.bidding > a.bidding) ? r : a));
  return { month: last.month, bidding: last.bidding };
}

/** LTA's published PQP for the latest month available, by category. */
export function latestPqp(category: "A" | "B"): { month: string; pqp: number } {
  const rows = data.pqp.rows.filter((r) => r.category === category);
  const last = rows.reduce((a, r) => (r.month > a.month ? r : a));
  return { month: last.month, pqp: last.pqp };
}

export function latestPremium(category: "A" | "B" | "E"): number {
  const e = latestExercise();
  return history.premium(e, category) ?? 0;
}
