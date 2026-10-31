import arfConfig from "./config/arf.json";
import emissionsConfig from "./config/emissions.json";
import { compareDates, exerciseInRange } from "./dates";
import type { Dollars, EmissionBand, Exercise, IsoDate } from "./types";

/**
 * Gross ARF on an OMV, using the tiers for the exercise the COE comes from. Rounded up to the dollar,
 * as LTA's car-cost tables show (OMV $25,626 → 27,876.4 → $27,877).
 */
export function grossArf(omv: Dollars, coeExercise: Exercise): Dollars {
  const schedule = arfConfig.schedules.find((s) =>
    exerciseInRange(coeExercise, s.fromExercise as Exercise | null, s.toExercise as Exercise | null),
  );
  if (!schedule) throw new Error(`No ARF schedule for exercise ${coeExercise.month}/${coeExercise.bidding}`);
  let arf = 0;
  let lower = 0;
  for (const bracket of schedule.brackets) {
    const upper = bracket.upToOmv ?? Infinity;
    if (omv > lower) arf += (Math.min(omv, upper) - lower) * bracket.rate;
    lower = upper;
  }
  return Math.ceil(arf - 1e-9);
}

export type EmissionsPeriod = (typeof emissionsConfig.periods)[number];

export function emissionsPeriod(registrationDate: IsoDate): EmissionsPeriod {
  const period = emissionsConfig.periods.find(
    (p) => compareDates(registrationDate, p.from) >= 0 && (p.to === null || compareDates(registrationDate, p.to) <= 0),
  );
  if (!period) throw new Error(`No emissions rules for registration on ${registrationDate}`);
  return period;
}

export interface NetArf {
  grossArf: Dollars;
  eeai: Dollars;
  vesRebate: Dollars;
  /** Paid on top of ARF; never part of the ARF that PARF is computed on. */
  vesSurcharge: Dollars;
  /** ARF actually paid after rebates; PARF is computed on this. */
  netArf: Dollars;
  /** True when the rules for this date are an assumption (no scheme announced). */
  assumed: boolean;
}

/**
 * ARF for a new car registered on `registrationDate`, after rebates and the minimum ARF.
 * As LTA's car-cost tables apply them: the VES rebate first, then EEAI, each limited to the ARF
 * still above the minimum (BYD Atto 1: ARF $14,388 → VES rebate $14,388, EEAI $0).
 */
export function netArf(args: {
  omv: Dollars;
  coeExercise: Exercise;
  registrationDate: IsoDate;
  band: EmissionBand;
  electric: boolean;
}): NetArf {
  const gross = grossArf(args.omv, args.coeExercise);
  const period = emissionsPeriod(args.registrationDate);
  const ves = period.ves[args.band];
  const vesSurcharge = ves > 0 ? ves : 0;
  const floor = Math.min(gross, args.electric ? period.minimumArf.electric : period.minimumArf.other);
  const vesRebate = Math.min(ves < 0 ? -ves : 0, gross - floor);
  const eeaiEntitlement = args.electric && period.eeai ? Math.min(Math.floor(gross * period.eeai.rate), period.eeai.capDollars) : 0;
  const eeai = Math.min(eeaiEntitlement, gross - floor - vesRebate);
  const net = gross - vesRebate - eeai;
  return { grossArf: gross, eeai, vesRebate, vesSurcharge, netArf: net, assumed: "assumed" in period && period.assumed === true };
}
