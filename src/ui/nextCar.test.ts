import { describe, expect, it } from "vitest";
import { rulesAt } from "../rules/index";
import lta from "../fixtures/lta-car-cost-2026-09.json";
import presets from "./config/presets.json";
import { latestPremium } from "./data";
import { defaultNextCar, nextCarFigures } from "./nextCar";

const FUEL: Record<string, string> = { E: "electric", R: "plug-in hybrid", H: "hybrid", P: "petrol" };
const rules = rulesAt("2026-11-01");
const figures = (presetId: string, change: object = {}) => nextCarFigures({ ...defaultNextCar(), presetId, ...change }, rules, "2026-11-01");

describe("presets match LTA's car-cost table", () => {
  it.each(presets.presets.map((p) => [p.label, p] as const))("%s", (_label, p) => {
    // A few names appear twice in LTA's table with different specs, so OMV picks the row.
    const row = lta.rows.find((r) => r.model === p.ltaModel && r.omv === p.omv);
    expect(row, `no LTA row "${p.ltaModel}"`).toBeDefined();
    expect({ category: p.category, omv: p.omv, band: p.band, powertrain: p.powertrain, electric: p.electric, priceWithCoe: p.priceWithCoe }).toEqual({
      category: row!.category,
      omv: row!.omv,
      band: row!.band,
      powertrain: FUEL[row!.fuel],
      electric: row!.fuel === "E",
      priceWithCoe: row!.priceWithCoe,
    });
  });
});

describe("next-car price", () => {
  it("moves the distributor's with-COE quote by the premium change since LTA's table", () => {
    const f = figures("byd-atto-3-evo-dynamic");
    expect(f.price).toBe(256888 + latestPremium("A") - 133009);
    expect(f.priceBasis).toMatchObject({ kind: "lta", quoted: 256888 });
  });

  it("uses the Cat B premium for a Cat B car", () => {
    expect(figures("byd-sealion-6-dmi").price).toBe(280388 + latestPremium("B") - 135001);
  });

  it("has no price for a car LTA lists without one, until a quote is typed", () => {
    expect(figures("jaecoo-6-ev").price).toBeUndefined();
    expect(figures("jaecoo-6-ev", { quotedPrice: "$215,888" })).toMatchObject({ price: 215888, priceBasis: { kind: "quote" } });
  });

  it("still works out ARF and the paper-value floor without a price", () => {
    const f = figures("jaecoo-6-ev");
    expect(f.arf.netArf).toBe(lta.rows.find((r) => r.model === "CHERY JAECOO6 EV 2WD 99KW")!.arf - 22500 - 7500);
    expect(f.floor).toBeGreaterThan(0);
  });
});
