import { addDays, addMonths, daysInclusive, parseDate } from "./dates";
import type { Dollars, IsoDate } from "./types";

/**
 * Unused COE period in months, as LTA counts it: full calendar months from the day after
 * deregistration, then leftover days at 30 days per month, to one decimal.
 * LTA example: deregistered 2 Jan 2013, expiry 5 Jun 2015 → 29 months + 3 days = 29.1 months.
 */
export function unusedCoeMonths(deregistrationDate: IsoDate, coeExpiryDate: IsoDate): number {
  const start = addDays(parseDate(deregistrationDate), 1);
  const expiry = parseDate(coeExpiryDate);
  if (daysInclusive(start, expiry) === 0) return 0;
  // A full month m is used up when its last day (start + m months - 1 day) is on or before expiry.
  let months = 0;
  while (daysInclusive(addDays(addMonths(start, months + 1), -1), expiry) > 0) months += 1;
  const leftoverDays = daysInclusive(addMonths(start, months), expiry);
  return months + Math.round((leftoverDays / 30) * 10) / 10;
}

/**
 * COE rebate: QP (or PQP for a renewed COE) × unused months / total months, rounded down to the dollar.
 * Total months is 120 for a 10-year COE and 60 for a 5-year renewal.
 */
export function coeRebate(args: {
  premiumPaid: Dollars;
  deregistrationDate: IsoDate;
  coeExpiryDate: IsoDate;
  termMonths: 60 | 120;
}): Dollars {
  const unused = unusedCoeMonths(args.deregistrationDate, args.coeExpiryDate);
  return Math.floor((args.premiumPaid * unused) / args.termMonths);
}
