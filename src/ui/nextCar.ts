/** Section 3: your next car — upfront cost, the paper-value floor when you sell, and the loan. */
import { addDays, addYears, exerciseForDate, type RuleSet } from "../rules/index";
import { field, h, longDate, money, signedMoney, source } from "./dom";
import { latestPremium } from "./data";
import presets from "./config/presets.json";
import bankRates from "./config/bank-rates.json";

export type Preset = (typeof presets.presets)[number];

export interface NextCarState {
  presetId: string;
  omvOverride: string;
  /** A dealer's with-COE quote typed by the visitor; overrides LTA's table. */
  quotedPrice: string;
  holdingYears: 5 | 8 | 10;
  marketPremium: number;
  loanAmount: string;
  tenureMonths: number;
  flatRate: number;
}

export function defaultNextCar(): NextCarState {
  const preset = presets.presets[0]!;
  return { presetId: preset.id, omvOverride: "", quotedPrice: "", holdingYears: 10, marketPremium: 0, loanAmount: "", tenureMonths: 84, flatRate: defaultRate(preset.electric) };
}

export function presetById(id: string): Preset {
  return presets.presets.find((p) => p.id === id) ?? presets.presets[0]!;
}

/** A typed positive whole-dollar amount, or undefined when blank or not one. */
function positiveWhole(value: string): number | undefined {
  const n = Number(value.replace(/[$,\s]/g, ""));
  return value.trim() && Number.isInteger(n) && n > 0 ? n : undefined;
}

function defaultRate(electric: boolean): number {
  const applicable = bankRates.rates.filter((r) => r.for === "any" || r.for === (electric ? "electric" : "non-electric")).map((r) => r.flatRate);
  return Math.min(...applicable);
}

export interface NextCarFigures {
  preset: Preset;
  omv: number;
  /** Undefined when LTA lists no distributor price and no quote has been typed. */
  price: number | undefined;
  priceBasis: { kind: "quote" } | { kind: "lta"; quoted: number; premiumChange: number } | { kind: "none" };
  arf: ReturnType<RuleSet["newCarArf"]>;
  floor: number;
  sellDate: string;
}

export function nextCarFigures(state: NextCarState, rules: RuleSet, purchaseDate: string): NextCarFigures {
  const preset = presetById(state.presetId);
  const category = preset.category as "A" | "B";
  const omv = positiveWhole(state.omvOverride) ?? preset.omv;
  const premium = latestPremium(category);
  const quote = positiveWhole(state.quotedPrice);
  let price: number | undefined;
  let priceBasis: NextCarFigures["priceBasis"] = { kind: "none" };
  if (quote !== undefined) {
    price = quote;
    priceBasis = { kind: "quote" };
  } else if (preset.priceWithCoe !== null) {
    // One method for every car, so they compare fairly: the dealer's with-COE quote, moved by
    // the premium's change since LTA's table was compiled.
    const premiumChange = premium - presets.quotePremiums[category];
    price = preset.priceWithCoe + premiumChange + (omv - preset.omv);
    priceBasis = { kind: "lta", quoted: preset.priceWithCoe, premiumChange };
  }
  const arf = rules.newCarArf({ omv, band: preset.band as "A" | "B" | "C1", electric: preset.electric, registrationDate: purchaseDate });
  const sellDate = addYears(purchaseDate, state.holdingYears);
  const floor = rules.deregistrationValue(
    {
      registrationDate: purchaseDate,
      coeExpiryDate: addDays(addYears(purchaseDate, 10), -1),
      coeExercise: exerciseForDate(purchaseDate),
      category,
      arfPaid: arf.netArf,
      quotaPremiumPaid: premium,
    },
    sellDate,
  ).total;
  return { preset, omv, price, priceBasis, arf, floor, sellDate };
}

export function nextCarSection(state: NextCarState, rules: RuleSet, purchaseDate: string, onChange: (s: NextCarState) => void): HTMLElement {
  const set = <K extends keyof NextCarState>(key: K, value: NextCarState[K]) => onChange({ ...state, [key]: value });
  const f = nextCarFigures(state, rules, purchaseDate);

  const presetSelect = h(
    "select",
    {
      onchange: (e: Event) => {
        const p = presetById((e.target as HTMLSelectElement).value);
        onChange({ ...state, presetId: p.id, omvOverride: "", quotedPrice: "", flatRate: defaultRate(p.electric) });
      },
    },
    ...(["electric", "plug-in hybrid", "hybrid", "petrol"] as const).map((pt) =>
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

  const maxLoan = f.price === undefined ? undefined : rules.maxLoan(f.price, f.omv);
  const typedLoan = positiveWhole(state.loanAmount);
  const loan = maxLoan === undefined ? undefined : Math.min(typedLoan ?? maxLoan, maxLoan);
  const plan = loan === undefined ? undefined : rules.flatRateLoan(loan, state.flatRate, state.tenureMonths);
  const rateOptions = bankRates.rates.filter((r) => r.for === "any" || r.for === (f.preset.electric ? "electric" : "non-electric"));

  return h(
    "div",
    { class: "two-col" },
    h(
      "div",
      { class: "form" },
      field("Car", presetSelect, undefined, `Prices from LTA's ${presets.edition} table of distributor quotes.`),
      field(
        f.preset.priceWithCoe === null ? "Price you were quoted" : "Price you were quoted (optional)",
        h("input", { type: "text", name: "quotedPrice", inputmode: "numeric", placeholder: f.price === undefined ? "e.g. 250,000" : "", value: state.quotedPrice, onchange: (e: Event) => set("quotedPrice", (e.target as HTMLInputElement).value) }),
        undefined,
        f.preset.priceWithCoe === null ? `With COE. LTA's ${presets.edition} table has no distributor price for this car.` : "With COE. Replaces the estimate from LTA's table.",
      ),
      field("OMV (optional)", h("input", { type: "text", inputmode: "numeric", placeholder: f.preset.omv.toLocaleString("en-SG"), value: state.omvOverride, onchange: (e: Event) => set("omvOverride", (e.target as HTMLInputElement).value) }), undefined, "Override to price a different car; ARF is recalculated."),
      field("How long will you keep it?", holding),
      h("hr"),
      field(
        "Loan amount",
        h("input", { type: "text", inputmode: "numeric", placeholder: maxLoan?.toLocaleString("en-SG") ?? "", value: state.loanAmount, onchange: (e: Event) => set("loanAmount", (e.target as HTMLInputElement).value) }),
        maxLoan !== undefined && typedLoan !== undefined && typedLoan > maxLoan ? `MAS caps this car's loan at ${money(maxLoan)}` : undefined,
        maxLoan === undefined ? "Enter the car's price first." : `Up to ${money(maxLoan)} (${f.omv <= 20000 ? "70" : "60"}% of price).`,
      ),
      field("Tenure", h("select", { onchange: (e: Event) => set("tenureMonths", Number((e.target as HTMLSelectElement).value)) }, ...[12, 24, 36, 48, 60, 72, 84].map((m) => h("option", { value: m, selected: state.tenureMonths === m }, `${m / 12} years`)))),
      field("Flat rate", h("select", { onchange: (e: Event) => set("flatRate", Number((e.target as HTMLSelectElement).value)) }, ...rateOptions.map((r) => h("option", { value: r.flatRate, selected: Math.abs(state.flatRate - r.flatRate) < 1e-9 }, `${(r.flatRate * 100).toFixed(2)}% — ${r.lender}`))), undefined, `Banks' own pages, checked ${longDate(bankRates.checked)}.`),
    ),
    h(
      "div",
      { class: "results" },
      h("div", { class: "kicker" }, "Price today (estimate)"),
      h("div", { class: "big" }, f.price === undefined ? "—" : money(f.price)),
      h("p", { class: "sub" }, priceExplanation(f)),
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
      plan && loan !== undefined ? h("div", { class: "big" }, `${money(plan.monthlyInstalmentCents / 100)} a month`) : h("div", { class: "big" }, "—"),
      plan && loan !== undefined
        ? h("p", { class: "sub" }, `${money(loan)} over ${state.tenureMonths / 12} years. Total interest ${money(plan.totalInterestCents / 100)}. Effective rate ${(plan.effectiveRate * 100).toFixed(2)}% a year (${(state.flatRate * 100).toFixed(2)}% flat).`)
        : h("p", { class: "sub" }, "Enter the car's price to work out the loan."),
      h("p", { class: "src-line" }, source(presets.source.split(": ").pop()!, "LTA car-cost table"), " · ", source("https://www.mas.gov.sg/news/media-releases/2016/mas-eases-rules-on-motor-vehicle-financing", "MAS loan limits")),
    ),
  );
}

function priceExplanation(f: NextCarFigures): string {
  const b = f.priceBasis;
  if (b.kind === "quote") return "The price you were quoted.";
  if (b.kind === "none") return `No distributor price in LTA's ${presets.edition} table. Enter a dealer's quote to price it.`;
  const omvChange = f.omv - f.preset.omv;
  return (
    `Distributor's with-COE quote in ${presets.edition}: ${money(b.quoted)}, ${signedMoney(b.premiumChange)} for the change in the Cat ${f.preset.category} premium since` +
    (omvChange ? `, ${signedMoney(omvChange)} for the OMV you entered.` : ".")
  );
}
