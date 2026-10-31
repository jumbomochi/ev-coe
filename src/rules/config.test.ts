import { describe, expect, it } from "vitest";
import parf from "./config/parf.json";
import arf from "./config/arf.json";
import emissions from "./config/emissions.json";
import loan from "./config/loan.json";
import { addDays, formatDate, parseDate } from "./dates";
import type { Exercise } from "./types";

function nextExercise(e: Exercise): Exercise {
  if (e.bidding === 1) return { month: e.month, bidding: 2 };
  const [y, m] = e.month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { month: next, bidding: 1 };
}

function expectContiguousExercises(schedules: { id: string; fromExercise: unknown; toExercise: unknown }[]) {
  expect(schedules[0]?.fromExercise, `${schedules[0]?.id} must start open`).toBeNull();
  expect(schedules.at(-1)?.toExercise, `${schedules.at(-1)?.id} must end open`).toBeNull();
  for (let i = 1; i < schedules.length; i++) {
    const prev = schedules[i - 1]!;
    const cur = schedules[i]!;
    expect(cur.fromExercise, `${prev.id} → ${cur.id} must leave no gap or overlap`).toEqual(nextExercise(prev.toExercise as Exercise));
  }
}

function expectContiguousDates(periods: { id: string; from: string; to: string | null }[]) {
  expect(periods.at(-1)?.to, `${periods.at(-1)?.id} must end open`).toBeNull();
  for (let i = 1; i < periods.length; i++) {
    const prev = periods[i - 1]!;
    const cur = periods[i]!;
    expect(cur.from, `${prev.id} → ${cur.id} must leave no gap or overlap`).toBe(formatDate(addDays(parseDate(prev.to!), 1)));
  }
}

describe("dated rule config", () => {
  it("covers every COE exercise exactly once for PARF", () => expectContiguousExercises(parf.schedules));
  it("covers every COE exercise exactly once for ARF", () => expectContiguousExercises(arf.schedules));
  it("covers every registration date from 2026 exactly once for emissions", () => expectContiguousDates(emissions.periods));
  it("has open-ended MAS loan rules", () => expectContiguousDates(loan.periods));

  it("keeps PARF tiers ordered by age", () => {
    for (const s of parf.schedules) {
      expect(s.tiers.map((t) => t.maxAgeYears)).toEqual([5, 6, 7, 8, 9, 10]);
    }
  });

  it("cites a source for every rule file", () => {
    for (const c of [parf, arf, loan]) expect(c.source).toMatch(/^https:\/\/(onemotoring\.lta|www\.lta|www\.mas)\.gov\.sg\//);
    expect(emissions.sources.length).toBeGreaterThan(0);
  });
});
