/** Section 3: your next car — upfront cost, the paper-value floor when you sell, and the loan. */
import { addDays, addYears, exerciseForDate, type RuleSet } from "../rules/index";
import { field, h, longDate, money, source } from "./dom";
import { latestPremium } from "./data";
import presets from "./config/presets.json";
import bankRates from "./config/bank-rates.json";

export type Preset = (typeof presets.presets)[number];

export interface NextCarState {
  presetId: string;
  omvOverride: string;
  holdingYears: 5 | 8 | 10;
  marketPremium: number;
  loanAmount: string;
  tenureMonths: number;
  flatRate: number;
}

export function defaultNextCar(): NextCarState {
  const preset = presets.presets[0]!;
  return { presetId: preset.id, omvOverride: "", holdingYears: 10, marketPremium: 0, loanAmount: "", tenureMonths: 84, flatRate: defaultRate(preset.electric) };
}

export function presetById(id: string): Preset {
  return presets.presets.find((p) => p.id === id) ?? presets.presets[0]!;
}

function defaultRate(electric: boolean): number {
  const applicable = bankRates.rates.filter((r) => r.for === "any" || r.for === (electric ? "electric" : "non-electric")).map((r) => r.flatRate);
  return Math.min(...applicable);
}

export interface NextCarFigures {
  preset: Preset;
  omv: number;
  price: number;
  arf: ReturnType<RuleSet["newCarArf"]>;
  floor: number;
  sellDate: string;
}

export function nextCarFigures(state: NextCarState, rules: RuleSet, purchaseDate: string): NextCarFigures {
  const preset = presetById(state.presetId);
  const omvTyped = Number(state.omvOverride.replace(/[$,\s]/g, ""));
  const omv = state.omvOverride && Number.isInteger(omvTyped) && omvTyped > 0 ? omvTyped : preset.omv;
  const premium = latestPremium(preset.category as "A" | "B");
  const price = preset.priceWithoutCoe + premium + (omv - preset.omv);
  const arf = rules.newCarArf({ omv, band: preset.band as "A" | "B" | "C1", electric: preset.electric, registrationDate: purchaseDate });
  const sellDate = addYears(purchaseDate, state.holdingYears);
  const floor = rules.deregistrationValue(
    {
      registrationDate: purchaseDate,
      coeExpiryDate: addDays(addYears(purchaseDate, 10), -1),
      coeExercise: exerciseForDate(purchaseDate),
      category: preset.category as "A" | "B",
      arfPaid: arf.netArf,
      quotaPremiumPaid: premium,
    },
    sellDate,
  ).total;
  return { preset, omv, price, arf, floor, sellDate };
}

export function nextCarSection(state: NextCarState, rules: RuleSet, purchaseDate: string, onChange: (s: NextCarState) => void): HTMLElement {
  const set = <K extends keyof NextCarState>(key: K, value: NextCarState[K]) => onChange({ ...state, [key]: value });
  const f = nextCarFigures(state, rules, purchaseDate);

  const presetSelect = h(
    "select",
    {
      onchange: (e: Event) => {
        const p = presetById((e.target as HTMLSelectElement).value);
        onChange({ ...state, presetId: p.id, omvOverride: "", flatRate: defaultRate(p.electric) });
      },
    },
    ...(["electric", "hybrid", "petrol"] as const).map((pt) =>
      h(
        "optgroup",
        { label: pt[0]!.toUpperCase() + pt.slice(1) },
        ...presets.presets.filter((p) => p.powertrain === pt).map((p) => h("option", { value: p.id, selected: p.id === f.preset.id }, `${p.label} (Cat ${p.category}, band ${p.band})`)),
      ),
    ),
  );

  const holding = h(
    "div",
    { class: "toggle small", role: "radiogroup", "aria-label": "How long will you keep it?" },
    ...([5, 8, 10] as const).map((y) => h("button", { type: "button", role: "radio", "aria-checked": state.holdingYears === y ? "true" : "false", class: state.holdingYears === y ? "on" : "", onclick: () => set("holdingYears", y) }, `${y} yrs`)),
  );

  const maxLoan = rules.maxLoan(f.price, f.omv);
  const typedLoan = Number(state.loanAmount.replace(/[$,\s]/g, ""));
  const loan = state.loanAmount && Number.isInteger(typedLoan) && typedLoan > 0 ? Math.min(typedLoan, maxLoan) : maxLoan;
  const plan = rules.flatRateLoan(loan, state.flatRate, state.tenureMonths);
  const rateOptions = bankRates.rates.filter((r) => r.for === "any" || r.for === (f.preset.electric ? "electric" : "non-electric"));

  return h(
    "div",
    { class: "two-col" },
    h(
      "div",
      { class: "form" },
      field("Car", presetSelect, undefined, `Prices from LTA's ${presets.edition} table of distributor quotes.`),
      field("OMV (optional)", h("input", { type: "text", inputmode: "numeric", placeholder: f.preset.omv.toLocaleString("en-SG"), value: state.omvOverride, onchange: (e: Event) => set("omvOverride", (e.target as HTMLInputElement).value) }), undefined, "Override to price a different car; ARF is recalculated."),
      field("How long will you keep it?", holding),
      h("hr"),
      field("Loan amount", h("input", { type: "text", inputmode: "numeric", placeholder: maxLoan.toLocaleString("en-SG"), value: state.loanAmount, onchange: (e: Event) => set("loanAmount", (e.target as HTMLInputElement).value) }), typedLoan > maxLoan ? `MAS caps this car's loan at ${money(maxLoan)}` : undefined, `Up to ${money(maxLoan)} (${f.omv <= 20000 ? "70" : "60"}% of price).`),
      field("Tenure", h("select", { onchange: (e: Event) => set("tenureMonths", Number((e.target as HTMLSelectElement).value)) }, ...[12, 24, 36, 48, 60, 72, 84].map((m) => h("option", { value: m, selected: state.tenureMonths === m }, `${m / 12} years`)))),
      field("Flat rate", h("select", { onchange: (e: Event) => set("flatRate", Number((e.target as HTMLSelectElement).value)) }, ...rateOptions.map((r) => h("option", { value: r.flatRate, selected: Math.abs(state.flatRate - r.flatRate) < 1e-9 }, `${(r.flatRate * 100).toFixed(2)}% — ${r.lender}`))), undefined, `Banks' own pages, checked ${longDate(bankRates.checked)}.`),
    ),
    h(
      "div",
      { class: "results" },
      h("div", { class: "kicker" }, "Price today (estimate)"),
      h("div", { class: "big" }, money(f.price)),
      h("p", { class: "sub" }, `Distributor price without COE + the latest Cat ${f.preset.category} premium. Their own with-COE quote in ${presets.edition}: ${money(f.preset.priceWithCoeSep2026)}.`),
      h("div", { class: "kicker" }, `ARF if registered ${longDate(purchaseDate)}`),
      h("div", { class: "big" }, money(f.arf.netArf)),
      h("p", { class: "sub" }, `Tiered ARF ${money(f.arf.grossArf)}`, f.arf.vesRebate ? ` − VES ${money(f.arf.vesRebate)}` : "", f.arf.eeai ? ` − EEAI ${money(f.arf.eeai)}` : "", f.arf.vesSurcharge ? `; plus VES surcharge ${money(f.arf.vesSurcharge)}` : "", "."),
      f.arf.assumed ? h("p", { class: "estimate" }, "No VES or EEAI has been announced after 2027: assumed $0 rebate and surcharge.") : null,
      h("div", { class: "kicker" }, `If you sell on ${longDate(f.sellDate)}`),
      h("div", { class: "big" }, money(f.floor + state.marketPremium)),
      h("p", { class: "sub" }, `Paper-value floor ${money(f.floor)} (COE rebate + PARF, fixed by the rules)`, state.marketPremium ? ` + ${money(state.marketPremium)} your guess.` : "."),
      field(
        "Market premium above the floor (your guess)",
        h("input", { type: "range", min: 0, max: 60000, step: 1000, value: state.marketPremium, onchange: (e: Event) => set("marketPremium", Number((e.target as HTMLInputElement).value)) }),
        undefined,
        "No official data exists. Dealers reported used EVs losing up to 40% of value vs about 10% for petrol (CNA, Dec 2025).",
      ),
      h("div", { class: "kicker" }, "Loan"),
      h("div", { class: "big" }, `${money(plan.monthlyInstalmentCents / 100)} a month`),
      h("p", { class: "sub" }, `${money(loan)} over ${state.tenureMonths / 12} years. Total interest ${money(plan.totalInterestCents / 100)}. Effective rate ${(plan.effectiveRate * 100).toFixed(2)}% a year (${(state.flatRate * 100).toFixed(2)}% flat).`),
      h("p", { class: "src-line" }, source(presets.source.split(": ").pop()!, "LTA car-cost table"), " · ", source("https://www.mas.gov.sg/news/media-releases/2016/mas-eases-rules-on-motor-vehicle-financing", "MAS loan limits")),
    ),
  );
}
