/**
 * The visitor's car, as typed into the form. Saved only in this browser (eng review D13) and
 * validated before any figure is shown (Section 2): impossible inputs give a message, not a number.
 */
import { compareDates, exerciseForDate, type CurrentCar, type Exercise } from "../rules/index";
import type { PremiumHistory } from "../model/premiums";

export interface Profile {
  mode: "replace" | "first";
  registrationDate: string;
  coeExpiryDate: string;
  category: "A" | "B" | "E";
  equivalentCategory: "A" | "B";
  arfPaid: string;
  qpMode: "actual" | "indicative";
  quotaPremiumPaid: string;
  renewal: "none" | "5" | "10";
  /** Optional override of the exercise the COE came from (defaults to the registration month). */
  coeMonth: string;
  coeBidding: "" | "1" | "2";
  /** First-car buyers: the month they plan to buy. */
  targetMonth: string;
}

export const EMPTY_PROFILE: Profile = {
  mode: "replace",
  registrationDate: "",
  coeExpiryDate: "",
  category: "A",
  equivalentCategory: "A",
  arfPaid: "",
  qpMode: "actual",
  quotaPremiumPaid: "",
  renewal: "none",
  coeMonth: "",
  coeBidding: "",
  targetMonth: "",
};

export type Errors = Partial<Record<keyof Profile, string>>;

export interface ValidCar {
  car: CurrentCar;
  /** Set when QP was estimated from COE history rather than typed in. */
  indicativeQp?: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function wholeDollars(value: string): number | undefined {
  const cleaned = value.replace(/[$,\s]/g, "");
  return /^\d+$/.test(cleaned) ? Number(cleaned) : undefined;
}

/** Average premium of the exercises in a month, for a category; undefined if no bidding that month. */
function monthPremium(history: PremiumHistory, month: string, category: "A" | "B" | "E"): number | undefined {
  const values = ([1, 2] as const).map((bidding) => history.premium({ month, bidding }, category)).filter((v): v is number => v !== undefined);
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : undefined;
}

export function validateCar(p: Profile, today: string, history: PremiumHistory): { ok: true; value: ValidCar } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const dateOk = (field: "registrationDate" | "coeExpiryDate", value: string) => {
    if (!ISO.test(value)) {
      errors[field] = "Enter a date";
      return false;
    }
    try {
      compareDates(value, value);
      return true;
    } catch {
      errors[field] = "Not a real date";
      return false;
    }
  };
  const regOk = dateOk("registrationDate", p.registrationDate);
  const expOk = dateOk("coeExpiryDate", p.coeExpiryDate);
  if (regOk && compareDates(p.registrationDate, today) > 0) errors.registrationDate = "Registration date is in the future";
  if (regOk && expOk && compareDates(p.coeExpiryDate, p.registrationDate) <= 0) errors.coeExpiryDate = "COE expiry must be after registration";
  if (expOk && !errors.coeExpiryDate && compareDates(p.coeExpiryDate, today) < 0) errors.coeExpiryDate = "This COE has already expired";

  const arf = wholeDollars(p.arfPaid);
  if (arf === undefined) errors.arfPaid = "Enter the ARF paid, in whole dollars ($0 is fine for many EVs)";

  let coeExercise: Exercise | undefined;
  if (p.coeMonth || p.coeBidding) {
    if (!/^\d{4}-\d{2}$/.test(p.coeMonth) || (p.coeBidding !== "1" && p.coeBidding !== "2")) errors.coeMonth = "Pick the month and 1st/2nd exercise";
    else coeExercise = { month: p.coeMonth, bidding: Number(p.coeBidding) as 1 | 2 };
  } else if (regOk) {
    coeExercise = exerciseForDate(p.registrationDate);
  }

  const renewed = p.renewal !== "none";
  let qp: number | undefined;
  let indicativeQp: number | undefined;
  if (p.qpMode === "indicative" && !renewed) {
    if (coeExercise) {
      indicativeQp = monthPremium(history, coeExercise.month, p.category);
      if (indicativeQp === undefined) errors.quotaPremiumPaid = `No COE results for ${coeExercise.month}; enter the QP from your log card`;
      qp = indicativeQp;
    }
  } else {
    qp = wholeDollars(p.quotaPremiumPaid);
    if (qp === undefined || qp === 0) errors.quotaPremiumPaid = renewed ? "Enter the PQP you paid to renew" : "Enter the QP you paid";
  }

  if (Object.keys(errors).length || !coeExercise || arf === undefined || qp === undefined) return { ok: false, errors };

  const car: CurrentCar = {
    registrationDate: p.registrationDate,
    coeExpiryDate: p.coeExpiryDate,
    coeExercise,
    category: p.category,
    arfPaid: arf,
    quotaPremiumPaid: qp,
  };
  if (renewed) car.renewal = { termYears: p.renewal === "5" ? 5 : 10 };
  if (p.category === "E") {
    car.equivalentCategory = p.equivalentCategory;
    const own = monthPremium(history, coeExercise.month, p.equivalentCategory);
    if (own !== undefined) car.ownCategoryPremiumSameExercise = own;
  }
  return { ok: true, value: { car, indicativeQp } };
}

const KEY = "ev-coe:profile:v1";

/** Reads the saved profile; `remembered` is false when the browser blocks storage. */
export function loadProfile(storage: () => Storage = () => localStorage): { profile: Profile; remembered: boolean } {
  try {
    const raw = storage().getItem(KEY);
    return { profile: raw ? { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) } : { ...EMPTY_PROFILE }, remembered: true };
  } catch {
    return { profile: { ...EMPTY_PROFILE }, remembered: false };
  }
}

export function saveProfile(profile: Profile, storage: () => Storage = () => localStorage): boolean {
  try {
    storage().setItem(KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function clearProfile(storage: () => Storage = () => localStorage): boolean {
  try {
    storage().removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
