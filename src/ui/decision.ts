/**
 * The answer at the top of the page: what each plan costs a year at today's prices.
 *
 *   Plan                       road access                   cost
 *   switch on date d           today … d, then H years       payback(today) − payback(d) + new car bought on d
 *   renew T years, then switch today … expiry+T, then H yrs  payback(today) + renewal cost + new car bought at expiry+T
 *
 * payback(d) is what LTA pays back if the current car is deregistered on d (PARF + COE rebate); keeping
 * the car gives up the difference. A new car costs its price less what it's worth after H years (the
 * paper-value floor plus the visitor's market-premium guess). Premiums and prices stay at today's level;
 * only ARF moves, with the rules in force on the purchase date (VES/EEAI end after 2027).
 */
import { addMonthsToDate, addYears, compareDates, type CurrentCar, type RuleSet } from "../rules/index";
import type { Radar } from "../model/radar";
import { nextCarFigures, type NextCarState } from "./nextCar";

const YEAR_MS = 365.25 * 86_400_000;
export const yearsBetween = (from: string, to: string): number => compareDates(to, from) / YEAR_MS;

export interface NewCarCost {
  date: string;
  /** Today's price, moved by the change in ARF (and VES surcharge) between today and `date`. */
  price: number;
  arfChange: number;
  /** The ARF rules on `date` are an assumption: no VES or EEAI announced yet. */
  assumed: boolean;
  /** Paper-value floor after the holding period, plus the visitor's market-premium guess. */
  resale: number;
  cost: number;
}

/** A new car bought on `date`; undefined when the car has no price (no LTA quote and none typed). */
export function newCarCost(state: NextCarState, rules: RuleSet, today: string, date: string): NewCarCost | undefined {
  const now = nextCarFigures(state, rules, today);
  if (now.price === undefined) return undefined;
  const then = date === today ? now : nextCarFigures(state, rules, date);
  const arfChange = then.arf.netArf + then.arf.vesSurcharge - (now.arf.netArf + now.arf.vesSurcharge);
  const price = now.price + arfChange;
  const resale = then.floor + state.marketPremium;
  return { date, price, arfChange, assumed: then.arf.assumed, resale, cost: price - resale };
}

/** Today, then one date a month up to and including the COE expiry date, on the expiry's day of the month. */
export function switchDates(today: string, expiry: string): string[] {
  const out: string[] = [];
  for (let k = 0; ; k++) {
    const d = addMonthsToDate(expiry, -k);
    if (compareDates(d, today) <= 0) break;
    out.push(d);
  }
  return [today, ...out.reverse()];
}

export interface SwitchPoint {
  date: string;
  /** What LTA pays back on deregistering on `date`. */
  payback: number;
  /** Payback given up by keeping the car from today to `date`. */
  waitCost: number;
  newCar?: NewCarCost;
  perYear?: number;
}

export interface RenewPlan {
  termYears: 5 | 10;
  renewalCost: number;
  /** When the renewed COE runs out and the next car is bought. */
  until: string;
  newCar?: NewCarCost;
  perYear?: number;
}

export interface Decision {
  points: SwitchPoint[];
  renewals: RenewPlan[];
  holdingYears: number;
  /** Lowest cost per year among the plans; undefined when the next car has no price. */
  best?: { kind: "switch"; point: SwitchPoint } | { kind: "renew"; plan: RenewPlan };
}

export function decide(car: CurrentCar, nextCar: NextCarState, rules: RuleSet, today: string, renewalPqp: number): Decision {
  const H = nextCar.holdingYears;
  const paybackToday = rules.deregistrationValue(car, today).total;
  const points: SwitchPoint[] = switchDates(today, car.coeExpiryDate).map((date) => {
    const payback = date === today ? paybackToday : rules.deregistrationValue(car, date).total;
    const waitCost = paybackToday - payback;
    const newCar = newCarCost(nextCar, rules, today, date);
    return { date, payback, waitCost, newCar, perYear: newCar && (waitCost + newCar.cost) / (yearsBetween(today, date) + H) };
  });
  const renewals: RenewPlan[] = rules.renewalOptions(car, renewalPqp).map((o) => {
    const until = addYears(car.coeExpiryDate, o.termYears);
    const newCar = newCarCost(nextCar, rules, today, until);
    return { termYears: o.termYears, renewalCost: o.cost, until, newCar, perYear: newCar && (paybackToday + o.cost + newCar.cost) / (yearsBetween(today, until) + H) };
  });

  let best: Decision["best"];
  for (const point of points) if (point.perYear !== undefined && (!best || point.perYear < bestValue(best))) best = { kind: "switch", point };
  for (const plan of renewals) if (plan.perYear !== undefined && (!best || plan.perYear < bestValue(best))) best = { kind: "renew", plan };
  return { points, renewals, holdingYears: H, best };
}

function bestValue(best: NonNullable<Decision["best"]>): number {
  return (best.kind === "switch" ? best.point.perYear : best.plan.perYear)!;
}

/** First-car buyers: buying on each of the next `months` months, kept for the holding period. */
export function buyPoints(nextCar: NextCarState, rules: RuleSet, today: string, months = 36): { date: string; newCar?: NewCarCost; perYear?: number }[] {
  return Array.from({ length: months + 1 }, (_, k) => {
    const date = k === 0 ? today : addMonthsToDate(today, k);
    const newCar = newCarCost(nextCar, rules, today, date);
    return { date, newCar, perYear: newCar && newCar.cost / nextCar.holdingYears };
  });
}

export interface SupplyReading {
  quarterStart: string;
  /** LTA's formula quota for the quarter (mid of the projection band once it's projected). */
  quota: number;
  projected: boolean;
}

/** The formula quota for the quarter containing `date`. Formula against formula, so Cat E's share and LTA's adjustments don't skew a comparison. */
export function supplyAt(radar: Radar, date: string): SupplyReading | undefined {
  const month = date.slice(0, 7);
  const q = radar.quarters.filter((r) => r.quarterStart <= month && r.formulaQuota).at(-1);
  return q && { quarterStart: q.quarterStart, quota: Math.round(q.formulaQuota!.mid), projected: !q.formulaFromActuals };
}
