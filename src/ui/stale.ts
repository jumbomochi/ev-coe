/**
 * Runs in the browser so a stopped workflow still shows a warning (eng review S2/D10).
 * T1 found DataMall publishes COE results within about a day of each exercise and exercises
 * are two weeks apart, so data older than 21 days means at least one exercise is missing.
 */
import { compareDates, type Exercise } from "../rules/index";
import { exerciseDate } from "../model/premiums";

export const STALE_AFTER_DAYS = 21;

export function daysBetween(from: string, to: string): number {
  return Math.round(compareDates(to, from) / 86_400_000);
}

export function staleness(latest: Exercise, today: string): { asOf: string; ageDays: number; stale: boolean } {
  const asOf = exerciseDate(latest);
  const ageDays = daysBetween(asOf, today);
  return { asOf, ageDays, stale: ageDays > STALE_AFTER_DAYS };
}
