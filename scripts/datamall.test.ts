import { describe, expect, it } from "vitest";
import { coeResults, parseCsv, revalidations, validate, type CoeResult, type Dataset } from "./datamall";

const HEADER = "month,bidding_no,vehicle_class,quota,bids_success,bids_received,premium";
const GOOD = [
  HEADER,
  "2026-10,1,Category A,1200,1190,1500,130001",
  "2026-10,2,Category A,1200,1195,1600,132004",
  "2026-10,2,Category B,800,790,1100,131901",
].join("\n");

function previous(rows: number, latestMonth: string): Dataset<CoeResult> {
  const row: CoeResult = { month: latestMonth, bidding: 1, category: "A", quota: 1, bidsSuccess: 1, bidsReceived: 1, premium: 1 };
  return { source: "x", latestMonth, rows: Array.from({ length: rows }, () => row) };
}

describe("validate (eng review D12 guard)", () => {
  it("accepts a well-formed file and reports its latest month", () => {
    const out = validate(coeResults, GOOD, previous(3, "2026-09"));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.dataset.latestMonth).toBe("2026-10");
      expect(out.dataset.rows[1]).toEqual({ month: "2026-10", bidding: 2, category: "A", quota: 1200, bidsSuccess: 1195, bidsReceived: 1600, premium: 132004 });
    }
  });

  it("accepts the first run with no published baseline", () => {
    expect(validate(coeResults, GOOD, null).ok).toBe(true);
  });

  it("rejects a renamed column", () => {
    const out = validate(coeResults, GOOD.replace("premium", "premium_sgd"), null);
    expect(out).toMatchObject({ ok: false });
  });

  it("rejects a row that doesn't parse", () => {
    const out = validate(coeResults, GOOD + "\n2026-10,3,Category A,1,1,1,1", null);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]).toMatch(/line 5: bad bidding_no/);
  });

  it("rejects a truncated row", () => {
    expect(validate(coeResults, GOOD + "\n2026-10,2,Category C,500", null).ok).toBe(false);
  });

  it("rejects a file with fewer rows than already published", () => {
    const out = validate(coeResults, GOOD, previous(4, "2026-09"));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]).toMatch(/fewer than the 4/);
  });

  it("rejects a file whose latest month is older than published", () => {
    const out = validate(coeResults, GOOD, previous(1, "2026-11"));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]).toMatch(/older than the published 2026-11/);
  });

  it("accepts grouped thousands, as LTA's newer rows use, but not malformed groups", () => {
    const quoted = GOOD + '\n2026-10,2,Category E,"1,152","1,140","1,333",135790';
    const out = validate(coeResults, quoted, null);
    expect(out.ok && out.dataset.rows.at(-1)).toMatchObject({ quota: 1152, bidsSuccess: 1140, bidsReceived: 1333 });
    expect(validate(coeResults, GOOD + '\n2026-10,2,Category E,"11,52",1,1,1', null).ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(validate(coeResults, HEADER, null).ok).toBe(false);
  });
});

describe("parsing", () => {
  it("handles quoted fields, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿"a","b ""x""",c\r\n1,2,3\r\n')).toEqual([
      ["a", 'b "x"', "c"],
      ["1", "2", "3"],
    ]);
  });

  it("reads revalidation terms and thousands separators", () => {
    const csv = '"month","type","category","number"\n"2026-08","10 Year","Category A","1,203"\n"2026-08","5 Year","Category B","98"';
    const out = validate(revalidations, csv, null);
    expect(out.ok && out.dataset.rows).toEqual([
      { month: "2026-08", termYears: 10, category: "Category A", number: 1203 },
      { month: "2026-08", termYears: 5, category: "Category B", number: 98 },
    ]);
  });
});
