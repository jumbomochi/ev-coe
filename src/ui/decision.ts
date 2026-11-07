/**
 * The answer at the top of the page: what each plan costs a year, in today's dollars.
 *
 *   Plan                       road access                   cost
 *   switch on date d           today … d, then H years       payback(today) − payback(d) + next car bought on d + running costs
 *   renew T years, then switch today … expiry+T, then H yrs  payback(today) + renewal cost + next car bought at expiry+T + running costs
 *
 * payback(d) is what LTA pays back if the current car is deregistered on d (PARF + COE rebate); keeping
 * the car gives up the difference, and renewing gives up all of it. A new car costs its price less what
 * it's worth after H years (the paper-value floor plus the visitor's market-premium guess); a used one
 * costs its price less the PARF when its COE runs out, and H is the COE it has left.
 *
 * Everything is in today's dollars. Car prices and renewal costs keep pace with inflation, moved by the
 * visitor's premium trend on top; LTA's paybacks are fixed dollar amounts, so inflation shrinks them.
 * Money spent later is discounted at the visitor's interest rate, and a plan's cost per year is the
 * steady yearly amount (rising with inflation) that has the same present value over its years of road
 * access. Running costs that differ between plans are the ones that grow with a car's age: repairs,
 * rising by the visitor's figure for each year past 5, and LTA's road tax surcharge past 10 years.
 * With no interest, no inflation and no repairs, this is total cost over total years.
 */
import { addMonthsToDate, addYears, compareDates, type CurrentCar, type RuleSet } from "../rules/index";
import type { Radar } from "../model/radar";
import { latestPremium } from "./data";
import { nextCarFigures, premiumAt, presetById, usedCarFigures, type NextCarState } from "./nextCar";

const YEAR_MS = 365.25 * 86_400_000;
export const yearsBetween = (from: string, to: string): number => compareDates(to, from) / YEAR_MS;

/**
 * Road tax a year for a typical petrol car of each category, by LTA's engine-capacity formula:
 * Cat A at 1,598cc, Cat B at 1,998cc. Electric cars pay by power instead, so they should type theirs.
 */
export const TYPICAL_ROAD_TAX = { A: 742, B: 1210 } as const;

/** Repairs start to climb once the usual 5-year warranty is over. */
export const REPAIRS_FROM_AGE = 5;

export function roadTaxFor(state: NextCarState, category: "A" | "B"): number {
  const typed = state.roadTax.replace(/[$,\s]/g, "");
  return /^\d+$/.test(typed) ? Number(typed) : TYPICAL_ROAD_TAX[category];
}

/** Discount factors and present values in today's dollars, for the visitor's interest and inflation. */
export function discounting(m: { interest: number; inflation: number }) {
  const realRate = (1 + m.interest) / (1 + m.inflation) - 1;
  const real = (t: number) => (1 + realRate) ** -t;
  return {
    /** An amount that keeps pace with inflation, paid in t years. */
    real,
    /** A fixed dollar amount, paid in t years: inflation and interest both shrink it. */
    fixed: (t: number) => (1 + m.interest) ** -t,
    /** Present value of a yearly amount f(t) (in today's dollars) paid evenly from year t0 to t1; month by month. */
    flow(t0: number, t1: number, f: (t: number) => number = () => 1): number {
      if (t1 <= t0) return 0;
      const n = Math.ceil((t1 - t0) * 12);
      const dt = (t1 - t0) / n;
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const t = t0 + (k + 0.5) * dt;
        sum += f(t) * real(t) * dt;
      }
      return sum;
    },
  };
}

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
  /** Its age in years when bought: 0 for a new car. */
  age: number;
}

/** The next car (new or used) bought on `date`; undefined when it has no price (none listed and none typed). */
export function newCarCost(state: NextCarState, rules: RuleSet, today: string, date: string): NewCarCost | undefined {
  const category = presetById(state.presetId).category as "A" | "B";
  const premiumChange = premiumAt(category, today, date, state.premiumTrend) - latestPremium(category);
  if (state.kind === "used") {
    const u = usedCarFigures(state, rules, today, date);
    if (u.price === undefined) return undefined;
    const age = yearsBetween(u.car.registrationDate, date);
    return { date, price: u.price, premiumChange, arfChange: 0, assumed: false, resale: u.resale, cost: u.price - u.resale, years: u.years, age };
  }
  const now = nextCarFigures(state, rules, today);
  if (now.price === undefined) return undefined;
  const then = date === today ? now : nextCarFigures(state, rules, date, latestPremium(category) + premiumChange);
  const arfChange = then.arf.netArf + then.arf.vesSurcharge - (now.arf.netArf + now.arf.vesSurcharge);
  const price = then.price! + arfChange;
  const resale = then.floor + state.marketPremium;
  return { date, price, premiumChange, arfChange, assumed: then.arf.assumed, resale, cost: price - resale, years: state.holdingYears, age: 0 };
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

/**
 * A plan's present value, split so the repair figure can be varied without recomputing:
 * cost = fixed + repairRise × perRise, spread over `years` (present value of a year of road access).
 */
export interface PlanValue {
  fixed: number;
  perRise: number;
  years: number;
}

const perYearAt = (v: PlanValue, repairRise: number) => (v.fixed + repairRise * v.perRise) / v.years;

export interface SwitchPoint {
  date: string;
  /** What LTA pays back on deregistering on `date`. */
  payback: number;
  /** Payback given up by keeping the car from today to `date`, in the dollars of the day. */
  waitCost: number;
  newCar?: NewCarCost;
  value?: PlanValue;
  perYear?: number;
}

export interface RenewPlan {
  termYears: 5 | 10;
  renewalCost: number;
  /** When the renewed COE runs out and the next car is bought. */
  until: string;
  newCar?: NewCarCost;
  value?: PlanValue;
  perYear?: number;
}

export interface Decision {
  points: SwitchPoint[];
  renewals: RenewPlan[];
  /** Years of driving the next car gives. */
  holdingYears: number;
  /** What LTA pays back at expiry, which renewing gives up. */
  paybackAtExpiry: number;
  roadTax: number;
  /** Lowest cost per year among the plans; undefined when the next car has no price. */
  best?: { kind: "switch"; point: SwitchPoint } | { kind: "renew"; plan: RenewPlan };
  /** The repair figure at which the cheapest renewal and the cheapest switch cost the same; undefined when they don't cross below $3,000. */
  repairBreakEven?: number;
}

const MAX_REPAIR_RISE = 3000;

export function decide(car: CurrentCar, nextCar: NextCarState, rules: RuleSet, today: string, renewalPqp: number): Decision {
  const H = nextCar.kind === "used" ? nextCar.usedYearsLeft : nextCar.holdingYears;
  const m = discounting(nextCar);
  const roadTax = roadTaxFor(nextCar, rules.renewalCategory(car));
  /** Present value of the age-related running costs of a car that is `ageToday` years old today (negative if not yet built), from year t0 to t1. */
  const ageing = (ageToday: number, t0: number, t1: number) => ({
    perRise: m.flow(t0, t1, (t) => Math.max(0, ageToday + t - REPAIRS_FROM_AGE)),
    tax: roadTax * m.flow(t0, t1, (t) => rules.roadTaxSurcharge(ageToday + t)),
  });
  const ageNow = yearsBetween(car.registrationDate, today);
  /** Keep the current car to year `tKeep` (having paid `outlay` for it), then drive `next` from then. */
  const plan = (outlay: number, tKeep: number, next: NewCarCost): PlanValue => {
    const keep = ageing(ageNow, 0, tKeep);
    const drive = ageing(next.age - tKeep, tKeep, tKeep + next.years);
    return {
      fixed: outlay + next.price * m.real(tKeep) - next.resale * m.fixed(tKeep + next.years) + keep.tax + drive.tax,
      perRise: keep.perRise + drive.perRise,
      years: m.flow(0, tKeep + next.years),
    };
  };

  const paybackToday = rules.deregistrationValue(car, today).total;
  const points: SwitchPoint[] = switchDates(today, car.coeExpiryDate).map((date) => {
    const payback = date === today ? paybackToday : rules.deregistrationValue(car, date).total;
    const t = yearsBetween(today, date);
    const newCar = newCarCost(nextCar, rules, today, date);
    const value = newCar && plan(paybackToday - payback * m.fixed(t), t, newCar);
    return { date, payback, waitCost: paybackToday - payback, newCar, value, perYear: value && perYearAt(value, nextCar.repairRise) };
  });
  // Renewal is paid at expiry at the PQP then, which follows the premium trend.
  const tExpiry = Math.max(0, yearsBetween(today, car.coeExpiryDate));
  const pqpGrowth = (1 + nextCar.premiumTrend) ** tExpiry;
  const renewals: RenewPlan[] = rules.renewalOptions(car, Math.round(renewalPqp * pqpGrowth)).map((o) => {
    const until = addYears(car.coeExpiryDate, o.termYears);
    const newCar = newCarCost(nextCar, rules, today, until);
    const value = newCar && plan(paybackToday + o.cost * m.real(tExpiry), yearsBetween(today, until), newCar);
    return { termYears: o.termYears, renewalCost: o.cost, until, newCar, value, perYear: value && perYearAt(value, nextCar.repairRise) };
  });

  let best: Decision["best"];
  for (const point of points) if (point.perYear !== undefined && (!best || point.perYear < bestValue(best))) best = { kind: "switch", point };
  for (const r of renewals) if (r.perYear !== undefined && (!best || r.perYear < bestValue(best))) best = { kind: "renew", plan: r };

  return {
    points,
    renewals,
    holdingYears: H,
    paybackAtExpiry: points.at(-1)!.payback,
    roadTax,
    best,
    repairBreakEven: best && repairBreakEven(points.flatMap((p) => p.value ?? []), renewals.flatMap((r) => r.value ?? [])),
  };
}

/** Where the cheapest renewal stops (or starts) beating the cheapest switch as repairs climb faster. */
function repairBreakEven(switches: PlanValue[], renewals: PlanValue[]): number | undefined {
  if (!switches.length || !renewals.length) return undefined;
  const gap = (rise: number) => Math.min(...renewals.map((v) => perYearAt(v, rise))) - Math.min(...switches.map((v) => perYearAt(v, rise)));
  let lo = 0;
  let hi = MAX_REPAIR_RISE;
  if (Math.sign(gap(lo)) === Math.sign(gap(hi))) return undefined;
  const rising = gap(hi) > gap(lo);
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) > 0 === rising) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function bestValue(best: NonNullable<Decision["best"]>): number {
  return (best.kind === "switch" ? best.point.perYear : best.plan.perYear)!;
}

/** First-car buyers: buying on each of the next `months` months, kept for the holding period; cost per year of owning it, in today's dollars. */
export function buyPoints(nextCar: NextCarState, rules: RuleSet, today: string, months = 36): { date: string; newCar?: NewCarCost; perYear?: number }[] {
  const m = discounting(nextCar);
  const roadTax = roadTaxFor(nextCar, presetById(nextCar.presetId).category as "A" | "B");
  return Array.from({ length: months + 1 }, (_, k) => {
    const date = k === 0 ? today : addMonthsToDate(today, k);
    const newCar = newCarCost(nextCar, rules, today, date);
    if (!newCar) return { date };
    const t = yearsBetween(today, date);
    const end = t + newCar.years;
    const ageToday = newCar.age - t;
    const running = m.flow(t, end, (u) => nextCar.repairRise * Math.max(0, ageToday + u - REPAIRS_FROM_AGE) + roadTax * rules.roadTaxSurcharge(ageToday + u));
    const pv = newCar.price * m.real(t) - newCar.resale * m.fixed(end) + running;
    return { date, newCar, perYear: pv / m.flow(t, end) };
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
