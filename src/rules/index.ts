/**
 * The only public entry point to LTA/MAS rules. Callers pick one "as of" date per calculation:
 *  - today, for the current car and live figures;
 *  - the purchase date, for a next car (VES/EEAI and loan rules in force then);
 *  - today, for backtests ("today's rules applied to past prices").
 * Rules that depend on a car's own dates (PARF schedule by COE exercise, ARF tiers, age tiers)
 * read them from the method arguments, never from the as-of date.
 */
import { netArf, type NetArf } from "./arf";
import { coeRebate } from "./coeRebate";
import { compareDates, parseDate } from "./dates";

/** Calendar helpers on `YYYY-MM-DD` dates, shared so callers never re-implement LTA's date counting. */
export { addDaysIso as addDays, addYears, compareDates } from "./dates";
import { flatRateLoan, loanRules, maxLoan, type FlatRateLoan } from "./loan";
import { parfRebate } from "./parf";
import { renewalCategory, renewalOptions, type RenewalOption } from "./renewal";
import type { CurrentCar, Dollars, EmissionBand, Exercise, IsoDate } from "./types";

export type { CoeCategory, CurrentCar, Dollars, EmissionBand, Exercise, IsoDate } from "./types";
export type { NetArf } from "./arf";
export type { FlatRateLoan } from "./loan";
export type { RenewalOption } from "./renewal";

export interface DeregistrationValue {
  parf: Dollars;
  coeRebate: Dollars;
  total: Dollars;
}

export interface NewCar {
  omv: Dollars;
  band: EmissionBand;
  electric: boolean;
  registrationDate: IsoDate;
  /** Defaults to the exercise in the registration month. */
  coeExercise?: Exercise;
}

export interface RuleSet {
  asOf: IsoDate;
  /** What LTA pays back if the current car is deregistered on `deregistrationDate`. */
  deregistrationValue(car: CurrentCar, deregistrationDate: IsoDate): DeregistrationValue;
  /** Renewal options for the current car at the given PQP of its renewal category. */
  renewalOptions(car: CurrentCar, pqp: Dollars): RenewalOption[];
  renewalCategory(car: CurrentCar): "A" | "B";
  /** ARF for a new car, with EEAI/VES rebates and minimum ARF for its registration date. */
  newCarArf(car: NewCar): NetArf;
  /** PARF a new car would get if deregistered on `deregistrationDate`. */
  newCarParf(car: NewCar, netArfPaid: Dollars, deregistrationDate: IsoDate): Dollars;
  maxLoan(purchasePrice: Dollars, omv: Dollars): Dollars;
  flatRateLoan(principal: Dollars, flatRate: number, tenureMonths: number): FlatRateLoan;
}

/** The exercise a COE bought in a given month most likely came from (2nd exercise if after the 15th). */
export function exerciseForDate(date: IsoDate): Exercise {
  const { y, m, d } = parseDate(date);
  return { month: `${y}-${String(m).padStart(2, "0")}`, bidding: d > 15 ? 2 : 1 };
}

export function rulesAt(asOf: IsoDate): RuleSet {
  parseDate(asOf);
  const loan = loanRules(asOf);
  return {
    asOf,
    deregistrationValue(car, deregistrationDate) {
      if (compareDates(deregistrationDate, car.registrationDate) < 0) {
        throw new Error("Deregistration date is before the registration date");
      }
      const parf = parfRebate({
        arfPaid: car.arfPaid,
        registrationDate: car.registrationDate,
        deregistrationDate,
        coeExercise: car.coeExercise,
        renewed: car.renewal !== undefined,
      });
      let premium = car.quotaPremiumPaid;
      if (car.category === "E" && car.renewal === undefined && car.ownCategoryPremiumSameExercise !== undefined) {
        premium = Math.min(premium, car.ownCategoryPremiumSameExercise);
      }
      const rebate = coeRebate({
        premiumPaid: premium,
        deregistrationDate,
        coeExpiryDate: car.coeExpiryDate,
        termMonths: car.renewal?.termYears === 5 ? 60 : 120,
      });
      return { parf, coeRebate: rebate, total: parf + rebate };
    },
    renewalOptions: (car, pqp) => renewalOptions(car, pqp),
    renewalCategory: (car) => renewalCategory(car),
    newCarArf: (car) =>
      netArf({
        omv: car.omv,
        coeExercise: car.coeExercise ?? exerciseForDate(car.registrationDate),
        registrationDate: car.registrationDate,
        band: car.band,
        electric: car.electric,
      }),
    newCarParf: (car, netArfPaid, deregistrationDate) =>
      parfRebate({
        arfPaid: netArfPaid,
        registrationDate: car.registrationDate,
        deregistrationDate,
        coeExercise: car.coeExercise ?? exerciseForDate(car.registrationDate),
        renewed: false,
      }),
    maxLoan: (price, omv) => maxLoan(loan, price, omv),
    flatRateLoan: (principal, rate, months) => flatRateLoan(principal, rate, months, loan),
  };
}
