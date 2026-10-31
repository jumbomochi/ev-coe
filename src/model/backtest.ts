/**
 * Replays plans against every historical bidding exercise (design doc "Backtest definition";
 * eng review D7, D16, D17, OV2). Each start exercise t is "your deadline": the day the old COE expires.
 *
 *   Plan                 window              outlays                       receipts / terminal value
 *   buy at deadline      t … t+10y           P(t) + ARF                    old PARF(t); new car at t+10y
 *   renew 5y, then buy   t … t+10y           ⌈PQP(t)/2⌉ + P(t+5y) + ARF    new car at t+10y (5 yrs old: COE ½ left, PARF 30%)
 *   buy a year early     t−1y … t+10y        P(t−1y) + ARF                 old PARF + COE rebate at t−1y; new car at expiry
 *
 * Every plan delivers 10 years of road access, so cost per year = net cost ÷ 10.
 * ARF and PARF come from a reference new car under today's rules (rulesAt(today)); nominal dollars.
 */
import { addDays, addYears, exerciseForDate, type CurrentCar, type Dollars, type EmissionBand, type Exercise, type RuleSet } from "../rules/index";
import boundaryConfig from "./config/boundaries.json";
import type { CoeResult } from "./data";
import { exerciseDate, PremiumHistory, shiftExercise } from "./premiums";

export type PlanId = "buy-at-deadline" | "renew-5-then-buy" | "buy-a-year-early" | "first-car";

export interface ReferenceCar {
  omv: Dollars;
  band: EmissionBand;
  electric: boolean;
}

export interface OldCar {
  arfPaid: Dollars;
  quotaPremiumPaid: Dollars;
  /** Exercise the real COE came from: picks the old car's PARF schedule. */
  coeExercise: Exercise;
  renewal?: { termYears: 5 | 10 };
}

export interface BacktestInput {
  coe: CoeResult[];
  rules: RuleSet;
  /** Category the next COE is bought in (a Cat E owner's A/B equivalent). */
  category: "A" | "B";
  newCar: ReferenceCar;
  /** Undefined for a first-car buyer. */
  oldCar?: OldCar;
}

export interface Outcome {
  start: Exercise;
  /** Plan cost per year of road access; for relative strips, minus "buy at deadline" at the same start. */
  value: number;
  /** The window spans a COE category rule change that affects this category and powertrain. */
  crossesBoundary: boolean;
}

export interface Strip {
  plan: PlanId;
  relative: boolean;
  outcomes: Outcome[];
  n: number;
  boundaryCrossings: number;
  median: number;
  p10: number;
  p90: number;
}

const ROAD_ACCESS_YEARS = 10;

export function backtest(input: BacktestInput): Strip[] {
  const history = new PremiumHistory(input.coe);
  const today = input.rules.asOf;
  const newCarArf = input.rules.newCarArf({ ...input.newCar, registrationDate: today }).netArf;
  const currentExercise = exerciseForDate(today);

  /** Value of a new COE car bought on `purchase` if given up on `exit` (PARF + unused COE). */
  const newCarExitValue = (premium: Dollars, purchase: string, exit: string): Dollars =>
    input.rules.deregistrationValue(
      {
        registrationDate: purchase,
        coeExpiryDate: addDays(addYears(purchase, 10), -1),
        coeExercise: currentExercise,
        category: input.category,
        arfPaid: newCarArf,
        quotaPremiumPaid: premium,
      },
      exit,
    ).total;

  const p = (e: Exercise) => history.premium(e, input.category);

  if (!input.oldCar) {
    const outcomes: Outcome[] = [];
    for (const t of history.exercises()) {
      const price = p(t);
      if (price === undefined) continue;
      const day = exerciseDate(t);
      const cost = price + newCarArf - newCarExitValue(price, day, addYears(day, ROAD_ACCESS_YEARS));
      outcomes.push({ start: t, value: cost / ROAD_ACCESS_YEARS, crossesBoundary: crosses(t, t, input) });
    }
    return [strip("first-car", false, outcomes)];
  }

  const oldCar = input.oldCar;
  const oldCarAt = (deadline: string): CurrentCar => ({
    registrationDate: addDays(addYears(deadline, -10), 1),
    coeExpiryDate: deadline,
    coeExercise: oldCar.coeExercise,
    category: input.category,
    arfPaid: oldCar.arfPaid,
    quotaPremiumPaid: oldCar.quotaPremiumPaid,
    renewal: oldCar.renewal,
  });
  const canRenew = oldCar.renewal?.termYears !== 5;

  const rows: { t: Exercise; base: number; renew?: number; early: number; crosses: boolean }[] = [];
  for (const t of history.exercises()) {
    const before = shiftExercise(t, -1);
    const after = shiftExercise(t, 5);
    const [pt, pBefore, pAfter] = [p(t), p(before), p(after)];
    const pqp = history.pqp(t.month, input.category);
    if (pt === undefined || pBefore === undefined || pAfter === undefined || pqp === undefined) continue;

    const deadline = exerciseDate(t);
    const old = oldCarAt(deadline);
    const end = addYears(deadline, ROAD_ACCESS_YEARS);

    const base = pt + newCarArf - input.rules.deregistrationValue(old, deadline).total - newCarExitValue(pt, deadline, end);

    const renewPurchase = addYears(deadline, 5);
    const renew = Math.ceil(pqp / 2) + pAfter + newCarArf - newCarExitValue(pAfter, renewPurchase, end);

    const earlyDay = addYears(deadline, -1);
    const earlyExpiry = addDays(addYears(earlyDay, 10), -1);
    const early =
      pBefore + newCarArf - input.rules.deregistrationValue(old, earlyDay).total - newCarExitValue(pBefore, earlyDay, earlyExpiry);

    rows.push({ t, base, renew: canRenew ? renew : undefined, early, crosses: crosses(before, after, input) });
  }

  const perYear = (v: number) => v / ROAD_ACCESS_YEARS;
  const strips = [strip("buy-at-deadline", false, rows.map((r) => ({ start: r.t, value: perYear(r.base), crossesBoundary: r.crosses })))];
  if (canRenew) {
    strips.push(strip("renew-5-then-buy", true, rows.map((r) => ({ start: r.t, value: perYear(r.renew! - r.base), crossesBoundary: r.crosses }))));
  }
  strips.push(strip("buy-a-year-early", true, rows.map((r) => ({ start: r.t, value: perYear(r.early - r.base), crossesBoundary: r.crosses }))));
  return strips;
}

function crosses(from: Exercise, to: Exercise, input: BacktestInput): boolean {
  return boundaryConfig.boundaries.some((b) => {
    if (!b.categories.includes(input.category)) return false;
    if (b.electricOnly && !input.newCar.electric) return false;
    const e = b.exercise as Exercise;
    return cmp(from, e) < 0 && cmp(e, to) <= 0;
  });
}

function cmp(a: Exercise, b: Exercise): number {
  return a.month === b.month ? a.bidding - b.bidding : a.month < b.month ? -1 : 1;
}

function strip(plan: PlanId, relative: boolean, outcomes: Outcome[]): Strip {
  const sorted = outcomes.map((o) => o.value).sort((a, b) => a - b);
  const q = (f: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(f * sorted.length) - 1))]! : NaN);
  return {
    plan,
    relative,
    outcomes,
    n: outcomes.length,
    boundaryCrossings: outcomes.filter((o) => o.crossesBoundary).length,
    median: q(0.5),
    p10: q(0.1),
    p90: q(0.9),
  };
}
