/**
 * LTA DataMall static datasets: what to download, how to parse each CSV, and the
 * checks that stop a broken or shrunken file from replacing good data (eng review D12).
 * Pure functions only; scripts/fetch-data.ts does the I/O.
 */
import type { CoeResult, Dataset, MonthlyCount, Pqp, Revalidation } from "../src/model/data";

export type { CoeResult, Dataset, MonthlyCount, Pqp, Revalidation };

const BASE = "https://datamall.lta.gov.sg/content/dam/datamall/datasets/Facts_Figures/Vehicle Registration/";

export interface Source<Row> {
  id: string;
  zipUrl: string;
  /** File name inside the zip (matched on the base name). */
  csvName: string;
  header: string[];
  parseRow(cells: string[]): Row;
  month(row: Row): string;
}

function month(value: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`bad month "${value}"`);
  return value;
}
/** Whole number, optionally with correctly grouped thousands separators ("1,152"), as LTA's newer rows use. */
function count(value: string): number {
  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(value)) throw new Error(`bad number "${value}"`);
  return Number(value.replace(/,/g, ""));
}
function category(value: string): CoeResult["category"] {
  const m = /^Category ([A-E])$/.exec(value);
  if (!m) throw new Error(`bad category "${value}"`);
  return m[1] as CoeResult["category"];
}

const url = (name: string) => BASE + encodeURIComponent(name).replace(/%2F/g, "/");

export const coeResults: Source<CoeResult> = {
  id: "coe-results",
  zipUrl: url("COE Bidding Results.zip"),
  csvName: "M11-coe_results.csv",
  header: ["month", "bidding_no", "vehicle_class", "quota", "bids_success", "bids_received", "premium"],
  parseRow: ([m, b, c, q, s, r, p]) => {
    if (b !== "1" && b !== "2") throw new Error(`bad bidding_no "${b}"`);
    return { month: month(m!), bidding: Number(b) as 1 | 2, category: category(c!), quota: count(q!), bidsSuccess: count(s!), bidsReceived: count(r!), premium: count(p!) };
  },
  month: (r) => r.month,
};

export const pqp: Source<Pqp> = {
  id: "pqp",
  zipUrl: url("COE Bidding Results.zip"),
  csvName: "M11-coe_results_pqp.csv",
  header: ["month", "vehicle_class", "pqp"],
  parseRow: ([m, c, p]) => ({ month: month(m!), category: category(c!), pqp: count(p!) }),
  month: (r) => r.month,
};

export const newRegistrations: Source<MonthlyCount> = {
  id: "new-registrations",
  zipUrl: url("Monthly New Registration of Motor Vehicles by Vehicle Quota Categories.zip"),
  csvName: "M02-New_Reg_by_Quota.csv",
  header: ["month", "category", "number"],
  parseRow: ([m, c, n]) => ({ month: month(m!), category: nonEmpty(c!), number: count(n!) }),
  month: (r) => r.month,
};

export const deregistrations: Source<MonthlyCount> = {
  id: "deregistrations",
  zipUrl: url("Monthly De-Registered Motor Vehicles under Vehicle Quota System (VQS).zip"),
  csvName: "M05-Dereg_by_Quota.csv",
  header: ["month", "category", "number"],
  parseRow: ([m, c, n]) => ({ month: month(m!), category: nonEmpty(c!), number: count(n!) }),
  month: (r) => r.month,
};

export const revalidations: Source<Revalidation> = {
  id: "revalidations",
  zipUrl: url("Monthly Revalidation of COE of Existing Vehicles.zip"),
  csvName: "M10-Monthly_COE_Revalidation.csv",
  header: ["month", "type", "category", "number"],
  parseRow: ([m, t, c, n]) => {
    const term = t === "5 Year" ? 5 : t === "10 Year" ? 10 : null;
    if (term === null) throw new Error(`bad type "${t}"`);
    return { month: month(m!), termYears: term, category: nonEmpty(c!), number: count(n!) };
  },
  month: (r) => r.month,
};

function nonEmpty(value: string): string {
  if (!value.trim()) throw new Error("empty category");
  return value;
}

export const SOURCES = [coeResults, pqp, newRegistrations, deregistrations, revalidations] as const;

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

export type Validation<Row> = { ok: true; dataset: Dataset<Row> } | { ok: false; errors: string[] };

/**
 * Parses a downloaded CSV and checks it against the last committed dataset:
 * exact header, every row parses, row count never drops, latest month never moves back.
 * On the first run (no previous dataset) only the last two checks are skipped.
 */
export function validate<Row>(source: Source<Row>, csv: string, previous: Dataset<Row> | null): Validation<Row> {
  const [header, ...body] = parseCsv(csv);
  const errors: string[] = [];
  if (!header || header.join(",") !== source.header.join(",")) {
    return { ok: false, errors: [`${source.id}: header is ${JSON.stringify(header)}, expected ${JSON.stringify(source.header)}`] };
  }
  const rows: Row[] = [];
  body.forEach((cells, i) => {
    if (cells.length !== source.header.length) {
      errors.push(`${source.id}: line ${i + 2} has ${cells.length} fields, expected ${source.header.length}`);
      return;
    }
    try {
      rows.push(source.parseRow(cells));
    } catch (e) {
      errors.push(`${source.id}: line ${i + 2}: ${(e as Error).message}`);
    }
  });
  if (rows.length === 0) errors.push(`${source.id}: no data rows`);
  if (errors.length) return { ok: false, errors };

  const latestMonth = rows.map(source.month).reduce((a, b) => (b > a ? b : a));
  if (previous) {
    if (rows.length < previous.rows.length) {
      errors.push(`${source.id}: ${rows.length} rows, fewer than the ${previous.rows.length} already published`);
    }
    if (latestMonth < previous.latestMonth) {
      errors.push(`${source.id}: latest month ${latestMonth} is older than the published ${previous.latestMonth}`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, dataset: { source: source.zipUrl, latestMonth, rows } };
}
