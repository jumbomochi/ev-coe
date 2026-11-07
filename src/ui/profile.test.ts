import { describe, expect, it } from "vitest";
import { PremiumHistory } from "../model/premiums";
import type { CoeResult } from "../model/data";
import { EMPTY_PROFILE, clearProfile, loadProfile, saveProfile, validateCar, type Profile } from "./profile";
import { staleness } from "./stale";

const rows: CoeResult[] = [
  { month: "2018-10", bidding: 1, category: "A", quota: 1, bidsSuccess: 1, bidsReceived: 1, premium: 26000 },
  { month: "2018-10", bidding: 2, category: "A", quota: 1, bidsSuccess: 1, bidsReceived: 1, premium: 28000 },
  { month: "2018-10", bidding: 1, category: "E", quota: 1, bidsSuccess: 1, bidsReceived: 1, premium: 30000 },
  { month: "2018-10", bidding: 2, category: "E", quota: 1, bidsSuccess: 1, bidsReceived: 1, premium: 32000 },
];
const history = new PremiumHistory(rows);
const TODAY = "2026-10-31";

const good: Profile = {
  ...EMPTY_PROFILE,
  registrationDate: "2018-10-15",
  coeExpiryDate: "2028-10-14",
  arfPaid: "$20,000",
  quotaPremiumPaid: "26,500",
};

describe("validateCar", () => {
  it("accepts log-card figures with $ and commas, and derives the COE exercise from registration", () => {
    const out = validateCar(good, TODAY, history);
    expect(out.ok && out.value.car).toMatchObject({ arfPaid: 20000, quotaPremiumPaid: 26500, coeExercise: { month: "2018-10", bidding: 1 } });
  });

  it("estimates QP from the registration month's premiums and labels it", () => {
    const out = validateCar({ ...good, qpMode: "indicative", quotaPremiumPaid: "" }, TODAY, history);
    expect(out.ok && out.value).toMatchObject({ indicativeQp: 27000, car: { quotaPremiumPaid: 27000 } });
  });

  it("needs only the expiry date: registration, ARF and QP are estimated and listed", () => {
    const out = validateCar({ ...EMPTY_PROFILE, coeExpiryDate: "2028-10-14" }, TODAY, history);
    expect(out.ok && out.value.car).toMatchObject({ registrationDate: "2018-10-15", coeExercise: { month: "2018-10", bidding: 1 }, arfPaid: 20000, quotaPremiumPaid: 27000 });
    expect(out.ok && out.value.estimates.map((e) => e.field)).toEqual(["registrationDate", "arfPaid", "quotaPremiumPaid"]);
  });

  it("estimates a typical Cat B car's ARF on the tiers of its COE exercise", () => {
    const out = validateCar({ ...good, category: "B", arfPaid: "" }, TODAY, history);
    // Pre-2023 tiers: 100% of the first $20,000 + 140% of the next $20,000.
    expect(out.ok && out.value.car.arfPaid).toBe(48000);
  });

  it("estimates a renewed car's PQP from the month it was renewed, and needs no ARF", () => {
    const out = validateCar({ ...EMPTY_PROFILE, coeExpiryDate: "2028-10-14", renewal: "5" }, TODAY, history, (month) => (month === "2023-10" ? 100001 : undefined));
    expect(out.ok && out.value.car).toMatchObject({ registrationDate: "2013-10-15", arfPaid: 0, quotaPremiumPaid: 50001, renewal: { termYears: 5 } });
  });

  it("asks for the actual QP when the registration month predates the COE history", () => {
    const out = validateCar({ ...good, registrationDate: "2005-06-01", qpMode: "indicative" }, TODAY, history);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.quotaPremiumPaid).toMatch(/No COE results for 2005-06/);
  });

  it.each<[string, Partial<Profile>, keyof Profile]>([
    ["future registration", { registrationDate: "2027-01-01" }, "registrationDate"],
    ["expiry before registration", { coeExpiryDate: "2018-01-01" }, "coeExpiryDate"],
    ["expired COE", { registrationDate: "2015-01-01", coeExpiryDate: "2025-01-01" }, "coeExpiryDate"],
    ["impossible date", { coeExpiryDate: "2028-02-30" }, "coeExpiryDate"],
    ["negative ARF", { arfPaid: "-5" }, "arfPaid"],
    ["zero QP", { quotaPremiumPaid: "0" }, "quotaPremiumPaid"],
    ["expiry more than 10 years away", { registrationDate: "", coeExpiryDate: "2037-01-01" }, "coeExpiryDate"],
    ["half-filled exercise", { coeMonth: "2018-10" }, "coeMonth"],
  ])("rejects %s with a message on the field", (_name, change, field) => {
    const out = validateCar({ ...good, ...change }, TODAY, history);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[field]).toBeTruthy();
  });

  it("says expiry-before-registration rather than 'expired' when both apply", () => {
    const out = validateCar({ ...good, coeExpiryDate: "2017-01-01" }, TODAY, history);
    expect(!out.ok && out.errors.coeExpiryDate).toBe("COE expiry must be after registration");
  });

  it("allows $0 ARF, as many EVs have", () => {
    expect(validateCar({ ...good, arfPaid: "0" }, TODAY, history).ok).toBe(true);
  });

  it("records a renewal and treats the premium field as the PQP paid", () => {
    const out = validateCar({ ...good, renewal: "5", quotaPremiumPaid: "60000" }, TODAY, history);
    expect(out.ok && out.value.car.renewal).toEqual({ termYears: 5 });
  });

  it("looks up a Cat E car's own-category premium for the rebate cap", () => {
    const out = validateCar({ ...good, category: "E", equivalentCategory: "A", quotaPremiumPaid: "31000" }, TODAY, history);
    expect(out.ok && out.value.car).toMatchObject({ equivalentCategory: "A", ownCategoryPremiumSameExercise: 27000 });
  });
});

describe("profile storage (eng review D13)", () => {
  function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  }
  const blocked = (): Storage => {
    throw new DOMException("blocked", "SecurityError");
  };

  it("remembers, then forgets after Clear my car", () => {
    const s = memoryStorage();
    expect(saveProfile(good, () => s)).toBe(true);
    expect(loadProfile(() => s).profile.arfPaid).toBe("$20,000");
    expect(clearProfile(() => s)).toBe(true);
    expect(loadProfile(() => s).profile).toEqual(EMPTY_PROFILE);
  });

  it("keeps working when the browser blocks storage", () => {
    expect(loadProfile(blocked)).toEqual({ profile: EMPTY_PROFILE, remembered: false });
    expect(saveProfile(good, blocked)).toBe(false);
    expect(clearProfile(blocked)).toBe(false);
  });
});

describe("staleness", () => {
  it("flags data more than 21 days past its latest exercise", () => {
    expect(staleness({ month: "2026-10", bidding: 2 }, "2026-11-10")).toMatchObject({ asOf: "2026-10-21", ageDays: 20, stale: false });
    expect(staleness({ month: "2026-10", bidding: 2 }, "2026-11-12")).toMatchObject({ ageDays: 22, stale: true });
  });
});
