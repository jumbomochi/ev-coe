/** Row shapes of the committed data/*.json files. scripts/datamall.ts writes them; src/model reads them. */

export type QuotaCategory = "A" | "B" | "C" | "D" | "E";

export interface CoeResult {
  month: string; // YYYY-MM
  bidding: 1 | 2;
  category: QuotaCategory;
  quota: number;
  bidsSuccess: number;
  bidsReceived: number;
  premium: number;
}

export interface Pqp {
  month: string;
  category: QuotaCategory;
  pqp: number;
}

/** Monthly new registrations or deregistrations; `category` is LTA's label, e.g. "Category A", "Taxis". */
export interface MonthlyCount {
  month: string;
  category: string;
  number: number;
}

export interface Revalidation {
  month: string;
  termYears: 5 | 10;
  category: string;
  number: number;
}

export interface Dataset<Row> {
  source: string;
  latestMonth: string;
  rows: Row[];
}
