import loanConfig from "./config/loan.json";
import { compareDates } from "./dates";
import type { Dollars, IsoDate } from "./types";

type LoanRules = (typeof loanConfig.periods)[number];

export function loanRules(date: IsoDate): LoanRules {
  const rules = loanConfig.periods.find(
    (p) => compareDates(date, p.from) >= 0 && (p.to === null || compareDates(date, p.to) <= 0),
  );
  if (!rules) throw new Error(`No MAS loan rules on ${date}`);
  return rules;
}

/** Largest loan MAS allows on a car: 70% of purchase price if OMV ≤ $20,000, else 60%. */
export function maxLoan(rules: LoanRules, purchasePrice: Dollars, omv: Dollars): Dollars {
  const ltv = omv <= rules.omvThreshold ? rules.ltvAtOrBelowThreshold : rules.ltvAboveThreshold;
  return Math.floor(purchasePrice * ltv);
}

export interface FlatRateLoan {
  /** Monthly instalment in cents, rounded up so the total repays the loan. */
  monthlyInstalmentCents: number;
  totalInterestCents: number;
  /** Effective annual interest rate (monthly rest, ×12), e.g. 0.0479 for 4.79%. */
  effectiveRate: number;
}

/**
 * Car loans in Singapore are quoted at a flat rate: interest = principal × rate × years, spread evenly.
 * The effective rate is the monthly-rest rate that gives the same instalments.
 */
export function flatRateLoan(principal: Dollars, flatRate: number, tenureMonths: number, rules: LoanRules): FlatRateLoan {
  if (tenureMonths < 1 || tenureMonths > rules.maxTenureMonths) {
    throw new Error(`Tenure must be 1-${rules.maxTenureMonths} months`);
  }
  if (principal <= 0) throw new Error("Loan must be positive");
  const principalCents = principal * 100;
  const interestCents = Math.round(principalCents * flatRate * (tenureMonths / 12));
  const instalment = Math.ceil((principalCents + interestCents) / tenureMonths);
  return {
    monthlyInstalmentCents: instalment,
    totalInterestCents: interestCents,
    effectiveRate: effectiveAnnualRate(principalCents, instalment, tenureMonths),
  };
}

/** Solves principal = instalment × (1 − (1+i)^−n) / i for the monthly rate i by bisection; returns 12i. */
function effectiveAnnualRate(principal: number, instalment: number, n: number): number {
  if (instalment * n <= principal) return 0;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 200; k++) {
    const i = (lo + hi) / 2;
    const pv = (instalment * (1 - Math.pow(1 + i, -n))) / i;
    if (pv > principal) lo = i;
    else hi = i;
  }
  return ((lo + hi) / 2) * 12;
}
