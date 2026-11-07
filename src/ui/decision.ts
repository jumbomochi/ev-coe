/**
 * The answer at the top of the page: what each plan costs a year at today's prices.
 *
 *   Plan                       road access                   cost
 *   switch on date d           today … d, then H years       payback(today) − payback(d) + new car bought on d
 *   renew T years, then switch today … expiry+T, then H yrs  payback(today) + renewal cost + new car bought at expiry+T
 *
 * payback(d) is what LTA pays back if the current car is deregistered on d (PARF + COE rebate); keeping
 * the car gives up the difference. A new car costs its price less what it's worth after H years (the
 * paper-value floor plus the visitor's market-premium guess); a used one costs its price less the PARF
 * when its COE runs out, and H is the COE it has left. Premiums move by the visitor's trend from
 * today's level (flat by default), and with them car prices and renewal costs; ARF follows the rules
 * in force on the purchase date (VES/EEAI end after 2027).
 */
import { addMonthsToDate, addYears, compareDates, type CurrentCar, type RuleSet } from "../rules/index";
import type { Radar } from "../model/radar";
import { latestPremium } from "./data";
import { nextCarFigures, premiumAt, presetById, usedCarFigures, type NextCarState } from "./nextCar";

const YEAR_MS = 365.25 * 86_400_000;
export const yearsBetween = (from: string, to: string): number => compareDates(to, from) / YEAR_MS;

export interface NewCarCost {
  date: string;
  /** Today's price, moved by the change in premium, and for a new car in ARF (and VES surcharge), between today and `date`. */
  price: number;
  /** Change in the category premium since today, under the visitor's trend. */
  premiumChange: number;
  arfChange: number;
  /** The ARF rules on `date` are an assumption: no VES or EEAI announced yet. */
  assumed: boolean;
  /** New: paper-value floor after the holding period, plus the visitor's market-premium guess. Used: the PARF when its COE runs out. */
  resale: number;
  cost: number;
  /** Years of driving it gives: the holding period, or a used car's COE left. */
  years: number;
}

/** The next car (new or used) bought on `date`; undefined when it has no price (none listed and none typed). */
export function newCarCost(state: NextCarState, rules: RuleSet, today: string, date: string): NewCarCost | undefined {
  const category = presetById(state.presetId).category as "A" | "B";
  const premiumChange = premiumAt(category, today, date, state.premiumTrend) - latestPremium(category);
  if (state.kind === "used") {
    const u = usedCarFigures(state, rules, today, date);
    if (u.price === undefined) return undefined;
    return { date, price: u.price, premiumChange, arfChange: 0, assumed: false, resale: u.resale, cost: u.price - u.resale, years: u.years };
  }
  const now = nextCarFigures(state, rules, today);
  if (now.price === undefined) return undefined;
  const then = date === today ? now : nextCarFigures(state, rules, date, latestPremium(category) + premiumChange);
  const arfChange = then.arf.netArf + then.arf.vesSurcharge - (now.arf.netArf + now.arf.vesSurcharge);
  const price = then.price! + arfChange;
  const resale = then.floor + state.marketPremium;
  return { date, price, premiumChange, arfChange, assumed: then.arf.assumed, resale, cost: price - resale, years: state.holdingYears };
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
  /** Years of driving the next car gives. */
  holdingYears: number;
  /** Lowest cost per year among the plans; undefined when the next car has no price. */
  best?: { kind: "switch"; point: SwitchPoint } | { kind: "renew"; plan: RenewPlan };
  /**
   * When renewing is cheapest: how much more a year the car, once past ten years old, could cost to
   * run (repairs, the road-tax surcharge) before the cheapest switch catches up.
   */
  upkeepBreakEven?: { plan: RenewPlan; versus: SwitchPoint; perYear: number };
}

export function decide(car: CurrentCar, nextCar: NextCarState, rules: RuleSet, today: string, renewalPqp: number): Decision {
  const H = nextCar.kind === "used" ? nextCar.usedYearsLeft : nextCar.holdingYears;
  const paybackToday = rules.deregistrationValue(car, today).total;
  const points: SwitchPoint[] = switchDates(today, car.coeExpiryDate).map((date) => {
    const payback = date === today ? paybackToday : rules.deregistrationValue(car, date).total;
    const waitCost = paybackToday - payback;
    const newCar = newCarCost(nextCar, rules, today, date);
    return { date, payback, waitCost, newCar, perYear: newCar && (waitCost + newCar.cost) / (yearsBetween(today, date) + H) };
  });
  // Renewal is paid at expiry at the PQP then, which follows the premium trend.
  const pqpGrowth = (1 + nextCar.premiumTrend) ** Math.max(0, yearsBetween(today, car.coeExpiryDate));
  const renewals: RenewPlan[] = rules.renewalOptions(car, Math.round(renewalPqp * pqpGrowth)).map((o) => {
    const until = addYears(car.coeExpiryDate, o.termYears);
    const newCar = newCarCost(nextCar, rules, today, until);
    return { termYears: o.termYears, renewalCost: o.cost, until, newCar, perYear: newCar && (paybackToday + o.cost + newCar.cost) / (yearsBetween(today, until) + H) };
  });

  let best: Decision["best"];
  for (const point of points) if (point.perYear !== undefined && (!best || point.perYear < bestValue(best))) best = { kind: "switch", point };
  for (const plan of renewals) if (plan.perYear !== undefined && (!best || plan.perYear < bestValue(best))) best = { kind: "renew", plan };

  let upkeepBreakEven: Decision["upkeepBreakEven"];
  if (best?.kind === "renew") {
    const versus = points.filter((p) => p.perYear !== undefined).reduce((a, p) => (p.perYear! < a.perYear! ? p : a));
    const plan = best.plan;
    // Extra upkeep U a year over the renewal's years: (cost + U × term) / span = the switch's cost per year.
    const perYear = ((versus.perYear! - plan.perYear!) * (yearsBetween(today, plan.until) + H)) / plan.termYears;
    upkeepBreakEven = { plan, versus, perYear };
  }
  return { points, renewals, holdingYears: H, best, upkeepBreakEven };
}

function bestValue(best: NonNullable<Decision["best"]>): number {
  return (best.kind === "switch" ? best.point.perYear : best.plan.perYear)!;
}

/** First-car buyers: buying on each of the next `months` months, kept for the holding period. */
export function buyPoints(nextCar: NextCarState, rules: RuleSet, today: string, months = 36): { date: string; newCar?: NewCarCost; perYear?: number }[] {
  return Array.from({ length: months + 1 }, (_, k) => {
    const date = k === 0 ? today : addMonthsToDate(today, k);
    const newCar = newCarCost(nextCar, rules, today, date);
    return { date, newCar, perYear: newCar && newCar.cost / newCar.years };
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
