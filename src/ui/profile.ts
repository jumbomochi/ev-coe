/**
 * The visitor's car, as typed into the form. Saved only in this browser (eng review D13) and
 * validated before any figure is shown (Section 2): impossible inputs give a message, not a number.
 */
import { addDays, addYears, compareDates, exerciseForDate, grossArf, type CurrentCar, type Exercise } from "../rules/index";
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

/** A figure the visitor left blank, filled in from history or a typical car, and said so on the page. */
export interface Estimate {
  field: "registrationDate" | "arfPaid" | "quotaPremiumPaid";
  note: string;
}

export interface ValidCar {
  car: CurrentCar;
  /** Set when QP was estimated from COE history rather than typed in. */
  indicativeQp?: number;
  estimates: Estimate[];
}

/** OMV of a typical car in each category, for estimating ARF when it isn't typed in. */
export const TYPICAL_OMV = { A: 20000, B: 40000 } as const;

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

/**
 * Only the COE expiry date is required. A blank registration date is taken as 10 years (plus any
 * renewal) before expiry, a blank ARF as a typical car's, and a blank QP or PQP from the premiums
 * of the month the COE was bought. Each estimate is returned so the page can say what it assumed.
 */
export function validateCar(
  p: Profile,
  today: string,
  history: PremiumHistory,
  pqpAt: (month: string, category: "A" | "B") => number | undefined = () => undefined,
): { ok: true; value: ValidCar } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const estimates: Estimate[] = [];
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
  const renewed = p.renewal !== "none";
  const renewalYears = p.renewal === "5" ? 5 : p.renewal === "10" ? 10 : 0;
  const expOk = dateOk("coeExpiryDate", p.coeExpiryDate);
  let registrationDate = p.registrationDate;
  let regOk = false;
  if (registrationDate.trim()) regOk = dateOk("registrationDate", registrationDate);
  else if (expOk) {
    registrationDate = addDays(addYears(p.coeExpiryDate, -10 - renewalYears), 1);
    regOk = true;
    estimates.push({ field: "registrationDate", note: `Registration taken as ${registrationDate}, ${10 + renewalYears} years before expiry.` });
  }
  if (regOk && compareDates(registrationDate, today) > 0) {
    if (p.registrationDate.trim()) errors.registrationDate = "Registration date is in the future";
    else errors.coeExpiryDate = "A COE runs at most 10 years: this expiry is too far away";
  }
  if (regOk && expOk && compareDates(p.coeExpiryDate, registrationDate) <= 0) errors.coeExpiryDate = "COE expiry must be after registration";
  if (expOk && !errors.coeExpiryDate && compareDates(p.coeExpiryDate, today) < 0) errors.coeExpiryDate = "This COE has already expired";

  let coeExercise: Exercise | undefined;
  if (p.coeMonth || p.coeBidding) {
    if (!/^\d{4}-\d{2}$/.test(p.coeMonth) || (p.coeBidding !== "1" && p.coeBidding !== "2")) errors.coeMonth = "Pick the month and 1st/2nd exercise";
    else coeExercise = { month: p.coeMonth, bidding: Number(p.coeBidding) as 1 | 2 };
  } else if (regOk) {
    coeExercise = exerciseForDate(registrationDate);
  }

  const ownCategory = p.category === "E" ? p.equivalentCategory : p.category;
  let arf: number | undefined;
  if (p.arfPaid.trim()) {
    arf = wholeDollars(p.arfPaid);
    if (arf === undefined) errors.arfPaid = "Enter the ARF paid, in whole dollars ($0 is fine for many EVs)";
  } else if (renewed) {
    // A renewed COE gets no PARF, so the ARF paid no longer matters.
    arf = 0;
  } else if (coeExercise) {
    arf = grossArf(TYPICAL_OMV[ownCategory], coeExercise);
    estimates.push({ field: "arfPaid", note: `ARF taken as ${dollars(arf)}, a typical Cat ${ownCategory} car's (OMV ${dollars(TYPICAL_OMV[ownCategory])}), before any rebate.` });
  }

  let qp: number | undefined;
  let indicativeQp: number | undefined;
  const estimateQp = p.qpMode === "indicative" || !p.quotaPremiumPaid.trim();
  if (renewed) {
    if (p.quotaPremiumPaid.trim()) {
      qp = wholeDollars(p.quotaPremiumPaid);
      if (qp === undefined || qp === 0) errors.quotaPremiumPaid = "Enter the PQP you paid to renew";
    } else if (expOk) {
      const month = addYears(p.coeExpiryDate, -renewalYears).slice(0, 7);
      const pqp = pqpAt(month, ownCategory);
      if (pqp === undefined) errors.quotaPremiumPaid = `No PQP published for ${month}; enter the PQP you paid to renew`;
      else {
        qp = renewalYears === 5 ? Math.ceil(pqp / 2) : pqp;
        indicativeQp = qp;
        estimates.push({ field: "quotaPremiumPaid", note: `Renewal cost taken as ${dollars(qp)}, from the Cat ${ownCategory} PQP for ${month}.` });
      }
    }
  } else if (estimateQp) {
    if (coeExercise) {
      indicativeQp = monthPremium(history, coeExercise.month, p.category);
      if (indicativeQp === undefined) errors.quotaPremiumPaid = `No COE results for ${coeExercise.month}; enter the QP from your log card`;
      else estimates.push({ field: "quotaPremiumPaid", note: `QP taken as ${dollars(indicativeQp)}, the average Cat ${p.category} premium in ${coeExercise.month}.` });
      qp = indicativeQp;
    }
  } else {
    qp = wholeDollars(p.quotaPremiumPaid);
    if (qp === undefined || qp === 0) errors.quotaPremiumPaid = "Enter the QP you paid";
  }

  if (Object.keys(errors).length || !coeExercise || arf === undefined || qp === undefined) return { ok: false, errors };

  const car: CurrentCar = {
    registrationDate,
    coeExpiryDate: p.coeExpiryDate,
    coeExercise,
    category: p.category,
    arfPaid: arf,
    quotaPremiumPaid: qp,
  };
  if (renewed) car.renewal = { termYears: renewalYears as 5 | 10 };
  if (p.category === "E") {
    car.equivalentCategory = p.equivalentCategory;
    const own = monthPremium(history, coeExercise.month, p.equivalentCategory);
    if (own !== undefined) car.ownCategoryPremiumSameExercise = own;
  }
  return { ok: true, value: { car, indicativeQp, estimates } };
}

const dollars = (n: number) => `$${n.toLocaleString("en-SG")}`;

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
