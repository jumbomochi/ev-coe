import parfConfig from "./config/parf.json";
import { addYears, compareDates, exerciseInRange } from "./dates";
import type { Dollars, Exercise, IsoDate } from "./types";

type Schedule = (typeof parfConfig.schedules)[number];

export function parfSchedule(coeExercise: Exercise): Schedule {
  const schedule = parfConfig.schedules.find((s) =>
    exerciseInRange(coeExercise, s.fromExercise as Exercise | null, s.toExercise as Exercise | null),
  );
  if (!schedule) throw new Error(`No PARF schedule for exercise ${coeExercise.month}/${coeExercise.bidding}`);
  return schedule;
}

/**
 * PARF rebate if the car is deregistered on `deregistrationDate`.
 * LTA wording: "Not more than 5 years" → 75%, "Above 5 but not more than 6 years" → 70%, ...
 * A car more than 10 years old, or one whose COE has been renewed, gets nothing.
 */
export function parfRebate(args: {
  arfPaid: Dollars;
  registrationDate: IsoDate;
  deregistrationDate: IsoDate;
  coeExercise: Exercise;
  renewed: boolean;
}): Dollars {
  if (args.renewed) return 0;
  const schedule = parfSchedule(args.coeExercise);
  const tier = schedule.tiers.find(
    (t) => compareDates(args.deregistrationDate, addYears(args.registrationDate, t.maxAgeYears)) <= 0,
  );
  if (!tier) return 0;
  const rebate = Math.floor(args.arfPaid * tier.rate);
  return schedule.capDollars === null ? rebate : Math.min(rebate, schedule.capDollars);
}
