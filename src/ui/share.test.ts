import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE } from "./profile";
import { defaultNextCar } from "./nextCar";
import { decodeScenario, encodeScenario } from "./share";

describe("share links", () => {
  const scenario = {
    profile: { ...EMPTY_PROFILE, coeExpiryDate: "2028-10-14", category: "B" as const, arfPaid: "20,000" },
    nextCar: { ...defaultNextCar(), presetId: "byd-sealion-6-dmi", holdingYears: 8 as const },
    switchAt: "2027-05-14",
  };

  it("round-trips a scenario through the URL fragment", () => {
    const hash = encodeScenario(scenario);
    expect(hash).toMatch(/^#s=[A-Za-z0-9_-]+$/);
    expect(decodeScenario(hash)).toEqual(scenario);
  });

  it("keeps only known fields with valid values", () => {
    const hash = "#s=" + btoa(JSON.stringify({ p: { category: "Z", evil: "<script>", arfPaid: 5 }, n: { presetId: "no-such-car", holdingYears: 99 } }));
    const s = decodeScenario(hash.replace(/=+$/, ""))!;
    expect(s.profile).toEqual(EMPTY_PROFILE);
    expect(s.nextCar.presetId).toBe(defaultNextCar().presetId);
    expect(s.nextCar.holdingYears).toBe(10);
  });

  it("ignores fragments that aren't scenarios", () => {
    expect(decodeScenario("")).toBeUndefined();
    expect(decodeScenario("#s=%%%")).toBeUndefined();
    expect(decodeScenario("#top")).toBeUndefined();
  });
});
