import type { CurrentCar, Dollars } from "./types";

export interface RenewalOption {
  termYears: 5 | 10;
  cost: Dollars;
}

/**
 * COE renewal options at a given PQP (OneMotoring, "COE renewal"):
 * 10 years costs the full PQP; 5 years costs 50% of PQP rounded up to the dollar.
 * A car already on a 5-year renewal cannot be renewed again.
 * A Cat E car renews at the PQP of its own category (the caller passes that PQP).
 */
export function renewalOptions(car: Pick<CurrentCar, "renewal">, pqp: Dollars): RenewalOption[] {
  if (car.renewal?.termYears === 5) return [];
  return [
    { termYears: 10, cost: pqp },
    { termYears: 5, cost: Math.ceil(pqp / 2) },
  ];
}

export function renewalCategory(car: Pick<CurrentCar, "category" | "equivalentCategory">): "A" | "B" {
  if (car.category !== "E") return car.category;
  if (!car.equivalentCategory) throw new Error("A Cat E car needs its A/B equivalent category to renew");
  return car.equivalentCategory;
}
