/** Whole Singapore dollars. LTA publishes every fee, premium and rebate in whole dollars. */
export type Dollars = number;

/** Calendar date as `YYYY-MM-DD`. */
export type IsoDate = string;

/** A COE bidding exercise: the month and whether it was the 1st or 2nd exercise that month. */
export interface Exercise {
  month: string; // YYYY-MM
  bidding: 1 | 2;
}

export type CoeCategory = "A" | "B" | "E";

/** The car being kept or deregistered. Field names follow the vehicle log card. */
export interface CurrentCar {
  /** Original registration date; the car's age (for PARF) counts from here. */
  registrationDate: IsoDate;
  coeExpiryDate: IsoDate;
  /** The exercise the COE was obtained in; selects the PARF schedule. */
  coeExercise: Exercise;
  category: CoeCategory;
  /** For a Cat E car: the A/B category it belongs to (renewal PQP, rebate cap). */
  equivalentCategory?: "A" | "B";
  /** Net ARF paid, after any CEVS/VES/EEAI rebate and excluding any surcharge. */
  arfPaid: Dollars;
  /** QP paid for the current COE (or PQP, if renewed). */
  quotaPremiumPaid: Dollars;
  /** Cat E only: the same exercise's QP for the car's own category (rebate uses the lower). */
  ownCategoryPremiumSameExercise?: Dollars;
  /** Set when the current COE is a renewal. */
  renewal?: { termYears: 5 | 10 };
}

export type EmissionBand = "A" | "B" | "C1" | "C2" | "C3";
