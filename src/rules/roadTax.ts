import roadTaxConfig from "./config/roadTax.json";

/** Road tax surcharge as a share of the road tax, for a car `ageYears` old (LTA: "More than 10 years old: 10%" ... "More than 14 years old: 50%"). */
export function roadTaxSurcharge(ageYears: number): number {
  return roadTaxConfig.surcharge.filter((t) => ageYears > t.olderThanYears).at(-1)?.rate ?? 0;
}
