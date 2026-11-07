/** Section 3: your next car, new or used — upfront cost, what comes back at the end, and the loan. */
import { addDays, addYears, compareDates, exerciseForDate, grossArf, type CurrentCar, type EmissionBand, type RuleSet } from "../rules/index";
import { field, h, longDate, method, money, signedMoney, source } from "./dom";
import { history, latestPremium } from "./data";
import presets from "./config/presets.json";
import bankRates from "./config/bank-rates.json";

export type Preset = (typeof presets.presets)[number];

/** The car a fresh visit starts with, and the fallback for an id that's no longer listed. */
const DEFAULT_PRESET = presets.presets.find((p) => p.id === "honda-hrv-15-dx-sin")!;

export interface NextCarState {
  kind: "new" | "used";
  presetId: string;
  omvOverride: string;
  /** A dealer's with-COE quote typed by the visitor; overrides LTA's table. */
  quotedPrice: string;
  holdingYears: 5 | 8 | 10;
  marketPremium: number;
  loanAmount: string;
  tenureMonths: number;
  flatRate: number;
  /** Assumed change in COE premiums a year from today, after inflation, e.g. 0.03 for 3% a year faster than prices in general. */
  premiumTrend: number;
  /** How much more a year a car costs to keep running for each year it is past 5 years old, in today's dollars. */
  repairRise: number;
  /** The current car's road tax a year, as typed; blank takes a typical car of its category. */
  roadTax: string;
  /** What money earns (or a loan costs) a year, and how fast prices in general rise: e.g. 0.03 and 0.02. */
  interest: number;
  inflation: number;
  /** A used car: whole years of COE left when bought, whether that COE is a 10-year renewal, and what's typed from the listing. */
  usedYearsLeft: number;
  usedRenewed: boolean;
  usedPrice: string;
  usedArf: string;
}

const YEAR_MS = 365.25 * 86_400_000;

/** The category premium on `date` if premiums change by `trend` a year from today's level. */
export function premiumAt(category: "A" | "B", today: string, date: string, trend: number): number {
  const latest = latestPremium(category);
  return trend === 0 ? latest : Math.round(latest * (1 + trend) ** (compareDates(date, today) / YEAR_MS));
}

export function defaultNextCar(): NextCarState {
  const preset = DEFAULT_PRESET;
  return {
    kind: "new",
    presetId: preset.id,
    omvOverride: "",
    quotedPrice: "",
    holdingYears: 10,
    marketPremium: 0,
    loanAmount: "",
    tenureMonths: 84,
    flatRate: defaultRate(preset.electric),
    premiumTrend: 0,
    repairRise: 300,
    roadTax: "",
    interest: 0.03,
    inflation: 0.02,
    usedYearsLeft: 5,
    usedRenewed: false,
    usedPrice: "",
    usedArf: "",
  };
}

export function presetById(id: string): Preset {
  return presets.presets.find((p) => p.id === id) ?? DEFAULT_PRESET;
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

/** A new car bought on `purchaseDate`; `premium` is the category premium then (today's by default). */
export function nextCarFigures(state: NextCarState, rules: RuleSet, purchaseDate: string, premium = latestPremium(presetById(state.presetId).category as "A" | "B")): NextCarFigures {
  const preset = presetById(state.presetId);
  const category = preset.category as "A" | "B";
  const omv = positiveWhole(state.omvOverride) ?? preset.omv;
  const quote = positiveWhole(state.quotedPrice);
  let price: number | undefined;
  let priceBasis: NextCarFigures["priceBasis"] = { kind: "none" };
  if (quote !== undefined) {
    // A quote is today's price; only its COE part moves with the premium.
    price = quote + premium - latestPremium(category);
    priceBasis = { kind: "quote" };
  } else if (preset.priceWithCoe !== null) {
    // One method for every car, so they compare fairly: the dealer's with-COE quote, moved by
    // the premium's change since LTA's table was compiled.
    const premiumChange = premium - presets.quotePremiums[category];
    price = preset.priceWithCoe + premiumChange + (omv - preset.omv);
    priceBasis = { kind: "lta", quoted: preset.priceWithCoe, premiumChange };
  }
  const arf = rules.newCarArf({ omv, band: preset.band as EmissionBand, electric: preset.electric, registrationDate: purchaseDate });
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

export interface UsedCarFigures {
  preset: Preset;
  omv: number;
  /** The used car as LTA sees it, bought on `date`. */
  car: CurrentCar;
  arfEstimated: boolean;
  years: number;
  premium: number;
  /** Suggested price range: COE left at the premium on `date`, the PARF still to come, and what's left of the car itself. */
  value?: { coeLeft: number; parf: number; bodyLow: number; bodyHigh: number; paperNow: number; low: number; high: number };
  /** The asking price typed in (moved with the premium for later dates), else the middle of the range. */
  price?: number;
  priceBasis: "asking" | "suggested" | "none";
  /** What LTA pays back when its COE runs out: the PARF, if it still has one. */
  resale: number;
}

/**
 * A used car with `usedYearsLeft` years of COE, bought on `date`. Used prices follow today's COE
 * premium rather than what the seller paid: a buyer can get the same years of COE for the premium
 * times the share of ten years left. On top come the PARF (paid when the COE ends) and the car itself,
 * worth the new car's price less its COE and ARF, run down by age: `share`² to `share` of that, where
 * `share` is the part of its first ten years still ahead. A car past ten on a renewed COE has no PARF
 * and little body value, so its range runs from the paper value to the COE left. Never below the paper
 * value, which a dealer can always claim by deregistering it.
 */
export function usedCarFigures(state: NextCarState, rules: RuleSet, today: string, date: string): UsedCarFigures {
  const preset = presetById(state.presetId);
  const category = preset.category as "A" | "B";
  const omv = positiveWhole(state.omvOverride) ?? preset.omv;
  const years = state.usedYearsLeft;
  const coeExpiryDate = addYears(date, years);
  const registrationDate = addDays(addYears(coeExpiryDate, state.usedRenewed ? -20 : -10), 1);
  const firstExercise = exerciseForDate(registrationDate);
  // A renewed COE dates from the renewal, ten years after registration.
  const coeExercise = state.usedRenewed ? exerciseForDate(addYears(registrationDate, 10)) : firstExercise;
  const typedArf = positiveWhole(state.usedArf);
  const premium = premiumAt(category, today, date, state.premiumTrend);
  const car: CurrentCar = {
    registrationDate,
    coeExpiryDate,
    coeExercise,
    category,
    arfPaid: typedArf ?? grossArf(omv, firstExercise),
    quotaPremiumPaid: history.premium(coeExercise, category) ?? premium,
    ...(state.usedRenewed ? { renewal: { termYears: 10 as const } } : {}),
  };
  const resale = rules.deregistrationValue(car, coeExpiryDate).total;
  const base = { preset, omv, car, arfEstimated: typedArf === undefined, years, premium, resale };

  const asking = positiveWhole(state.usedPrice);
  const coeLeft = Math.round((premium * years) / 10);
  const newCar = nextCarFigures({ ...state, quotedPrice: "" }, rules, today);
  if (newCar.price === undefined) {
    if (asking === undefined) return { ...base, priceBasis: "none" };
    return { ...base, price: asking + coeLeft - Math.round((latestPremium(category) * years) / 10), priceBasis: "asking" };
  }
  const body = Math.max(0, newCar.price - latestPremium(category) - newCar.arf.netArf - newCar.arf.vesSurcharge);
  const share = Math.max(0, 1 - compareDates(date, registrationDate) / YEAR_MS / 10);
  const parf = resale;
  const paperNow = rules.deregistrationValue(car, date).total;
  const bodyLow = Math.round(body * share * share);
  const bodyHigh = Math.round(body * share);
  const low = state.usedRenewed ? Math.min(paperNow, coeLeft) : Math.max(paperNow, coeLeft + parf + bodyLow);
  const high = Math.max(paperNow, coeLeft + parf + bodyHigh);
  const value = { coeLeft, parf, bodyLow, bodyHigh, paperNow, low, high };
  if (asking !== undefined) return { ...base, value, price: asking + coeLeft - Math.round((latestPremium(category) * years) / 10), priceBasis: "asking" };
  return { ...base, value, price: Math.round((low + high) / 2), priceBasis: "suggested" };
}

/** "new Honda HR-V 1.5 DX", or "used Honda HR-V 1.5 DX with 5 years of COE". */
export function carName(s: NextCarState): string {
  const label = presetById(s.presetId).label;
  return s.kind === "used" ? `used ${label} with ${s.usedYearsLeft} year${s.usedYearsLeft === 1 ? "" : "s"} of COE` : `new ${label}`;
}

/** LTA's with-COE quote moved to today's premium, rounded to the nearest $1,000 for the picker. */
function pickerPrice(p: Preset): string {
  if (p.priceWithCoe === null) return "no price listed";
  const category = p.category as "A" | "B";
  return money(Math.round((p.priceWithCoe + latestPremium(category) - presets.quotePremiums[category]) / 1000) * 1000);
}

/** The next-car picker, grouped by powertrain and sorted by name. Shown at the top and in the next-car section; both edit the same state. */
export function carSelect(state: NextCarState, onChange: (s: NextCarState) => void, name = "presetId"): HTMLSelectElement {
  return h(
    "select",
    {
      name,
      onchange: (e: Event) => {
        const p = presetById((e.target as HTMLSelectElement).value);
        onChange({ ...state, presetId: p.id, omvOverride: "", quotedPrice: "", flatRate: defaultRate(p.electric) });
      },
    },
    ...(["electric", "plug-in hybrid", "hybrid", "petrol"] as const).map((pt) =>
      h(
        "optgroup",
        { label: pt[0]!.toUpperCase() + pt.slice(1) },
        ...presets.presets
          .filter((p) => p.powertrain === pt)
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((p) => h("option", { value: p.id, selected: p.id === state.presetId }, `${p.label} · Cat ${p.category} · ${pickerPrice(p)}`)),
      ),
    ),
  );
}

/** New or used, as a compact select beside the car picker at the top of the page. */
export function kindSelect(state: NextCarState, onChange: (s: NextCarState) => void, name: string): HTMLSelectElement {
  return h(
    "select",
    { name, "aria-label": "New or used", onchange: (e: Event) => onChange({ ...state, kind: (e.target as HTMLSelectElement).value as NextCarState["kind"], loanAmount: "" }) },
    h("option", { value: "new", selected: state.kind === "new" }, "New"),
    h("option", { value: "used", selected: state.kind === "used" }, "Used"),
  );
}

export function nextCarSection(state: NextCarState, rules: RuleSet, today: string, purchaseDate: string, onChange: (s: NextCarState) => void): HTMLElement {
  const set = <K extends keyof NextCarState>(key: K, value: NextCarState[K]) => onChange({ ...state, [key]: value });
  const kind = h(
    "div",
    { class: "toggle small", role: "radiogroup", "aria-label": "New or used" },
    ...(["new", "used"] as const).map((k) =>
      h("button", { type: "button", role: "radio", "aria-checked": state.kind === k ? "true" : "false", class: state.kind === k ? "on" : "", onclick: () => onChange({ ...state, kind: k, loanAmount: "" }) }, k === "new" ? "New" : "Used"),
    ),
  );
  return state.kind === "used" ? usedSection(state, rules, today, kind, set, onChange) : newSection(state, rules, purchaseDate, kind, set, onChange);
}

type Setter = <K extends keyof NextCarState>(key: K, value: NextCarState[K]) => void;

function newSection(state: NextCarState, rules: RuleSet, purchaseDate: string, kind: HTMLElement, set: Setter, onChange: (s: NextCarState) => void): HTMLElement {
  const f = nextCarFigures(state, rules, purchaseDate);

  const presetSelect = carSelect(state, onChange);

  const holding = h(
    "div",
    { class: "toggle small", role: "radiogroup", "aria-label": "How long will you keep it?" },
    ...([5, 8, 10] as const).map((y) => h("button", { type: "button", role: "radio", "aria-checked": state.holdingYears === y ? "true" : "false", class: state.holdingYears === y ? "on" : "", onclick: () => set("holdingYears", y) }, `${y} yrs`)),
  );

  const loan = loanParts(state, rules, f.price, f.omv, f.preset.electric, 84, set);

  return h(
    "div",
    { class: "two-col" },
    h(
      "div",
      { class: "form" },
      field("New or used", kind),
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
      ...loan.fields,
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
      ...loan.results,
      h("p", { class: "src-line" }, source(presets.source.split(": ").pop()!, "LTA car-cost table"), " · ", source("https://www.mas.gov.sg/news/media-releases/2016/mas-eases-rules-on-motor-vehicle-financing", "MAS loan limits")),
    ),
  );
}

function usedSection(state: NextCarState, rules: RuleSet, today: string, kind: HTMLElement, set: Setter, onChange: (s: NextCarState) => void): HTMLElement {
  const u = usedCarFigures(state, rules, today, today);
  const v = u.value;
  const category = u.preset.category;
  const round = (n: number) => money(Math.round(n / 1000) * 1000);
  const loan = loanParts(state, rules, u.price, u.omv, u.preset.electric, Math.min(84, u.years * 12), set);
  const asking = positiveWhole(state.usedPrice);

  return h(
    "div",
    { class: "two-col" },
    h(
      "div",
      { class: "form" },
      field("New or used", kind),
      field("Model", carSelect(state, onChange), undefined, "The same or a similar model. Its price new today sets what the car itself is worth."),
      field(
        "Years of COE left",
        h("select", { name: "usedYearsLeft", onchange: (e: Event) => set("usedYearsLeft", Number((e.target as HTMLSelectElement).value)) }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((y) => h("option", { value: y, selected: state.usedYearsLeft === y }, `${y} year${y === 1 ? "" : "s"}`))),
        undefined,
        state.usedRenewed ? `So it was registered about ${20 - u.years} years ago.` : `So it's about ${10 - u.years} year${10 - u.years === 1 ? "" : "s"} old.`,
      ),
      h(
        "label",
        { class: "check" },
        h("input", { type: "checkbox", name: "usedRenewed", checked: state.usedRenewed, onchange: (e: Event) => set("usedRenewed", (e.target as HTMLInputElement).checked) }),
        " Its COE has been renewed (the car is over 10 years old)",
      ),
      field(
        "Asking price (optional)",
        h("input", { type: "text", name: "usedPrice", inputmode: "numeric", placeholder: v ? round((v.low + v.high) / 2).slice(1) : "e.g. 90,000", value: state.usedPrice, onchange: (e: Event) => set("usedPrice", (e.target as HTMLInputElement).value) }),
        undefined,
        "From the listing. Replaces the suggested price.",
      ),
      field("OMV (optional)", h("input", { type: "text", inputmode: "numeric", placeholder: u.preset.omv.toLocaleString("en-SG"), value: state.omvOverride, onchange: (e: Event) => set("omvOverride", (e.target as HTMLInputElement).value) }), undefined, "On the listing; sets the ARF estimate."),
      field(
        "ARF paid (optional)",
        h("input", { type: "text", name: "usedArf", inputmode: "numeric", placeholder: u.car.arfPaid.toLocaleString("en-SG"), value: state.usedArf, onchange: (e: Event) => set("usedArf", (e.target as HTMLInputElement).value) }),
        undefined,
        "On the listing. Sets the PARF it gets back; estimated from the OMV if blank.",
      ),
      h("hr"),
      ...loan.fields,
    ),
    h(
      "div",
      { class: "results" },
      h("div", { class: "kicker" }, "Suggested price today"),
      h("div", { class: "big" }, v ? (round(v.low) === round(v.high) ? round(v.low) : `${round(v.low)} – ${round(v.high)}`) : "—"),
      v
        ? h(
            "p",
            { class: "sub" },
            `${money(v.coeLeft)} for ${u.years} years of COE at today's Cat ${category} premium of ${money(u.premium)}`,
            u.car.renewal ? "" : `, plus ${money(v.parf)} PARF when its COE runs out`,
            v.bodyHigh ? `, plus ${money(v.bodyLow)} to ${money(v.bodyHigh)} for the car itself` : "",
            ". ",
            v.low === v.paperNow ? `Never below the ${money(v.paperNow)} LTA would pay back if it were deregistered today.` : "",
          )
        : h("p", { class: "sub" }, `LTA's ${presets.edition} table has no price for this model new, so there's no suggestion. Enter the asking price.`),
      asking !== undefined && v
        ? h("p", { class: asking > v.high ? "estimate" : "sub" }, asking > v.high ? `The asking price is ${money(asking - v.high)} above the range.` : asking < v.low ? `The asking price is ${money(v.low - asking)} below the range. Check why.` : "The asking price is within the range.")
        : null,
      h("div", { class: "kicker" }, "Depreciation"),
      h("div", { class: "big" }, u.price === undefined ? "—" : `${money((u.price - u.resale) / u.years)} a year`),
      u.price === undefined
        ? null
        : h(
            "p",
            { class: "sub" },
            `${u.priceBasis === "asking" ? "Asking price" : "Middle of the range"} ${money(u.price)}, less ${money(u.resale)} back from LTA when its COE runs out on ${longDate(u.car.coeExpiryDate)}, over ${u.years} years. Listings call this depreciation.`,
          ),
      u.arfEstimated && !u.car.renewal ? h("p", { class: "estimate" }, `ARF estimated at ${money(u.car.arfPaid)} from the OMV, before any rebates it got. The listing has the real figure.`) : null,
      ...loan.results,
      method(
        h(
          "p",
          {},
          "Used prices follow today's COE premium, not what the seller paid: the same years of COE would cost today's premium times the share of ten years left. ",
          "On top come the PARF the car still earns (none once its COE has been renewed) and the car itself: its price new today, less its COE and ARF, ",
          "times somewhere between (years of COE left ÷ 10)² and (years of COE left ÷ 10). That last part is the rough guess, and the reason for a range. ",
          "The premium setting at the top moves what the same car would cost if you bought it later.",
        ),
      ),
    ),
  );
}

/** Loan inputs and the instalment, shared by new and used. */
function loanParts(state: NextCarState, rules: RuleSet, price: number | undefined, omv: number, electric: boolean, maxTenure: number, set: Setter): { fields: HTMLElement[]; results: HTMLElement[] } {
  const maxLoan = price === undefined ? undefined : rules.maxLoan(price, omv);
  const typedLoan = positiveWhole(state.loanAmount);
  const loan = maxLoan === undefined ? undefined : Math.min(typedLoan ?? maxLoan, maxLoan);
  const tenure = Math.min(state.tenureMonths, maxTenure);
  const plan = loan === undefined ? undefined : rules.flatRateLoan(loan, state.flatRate, tenure);
  const rateOptions = bankRates.rates.filter((r) => r.for === "any" || r.for === (electric ? "electric" : "non-electric"));
  return {
    fields: [
      field(
        "Loan amount",
        h("input", { type: "text", inputmode: "numeric", placeholder: maxLoan?.toLocaleString("en-SG") ?? "", value: state.loanAmount, onchange: (e: Event) => set("loanAmount", (e.target as HTMLInputElement).value) }),
        maxLoan !== undefined && typedLoan !== undefined && typedLoan > maxLoan ? `MAS caps this car's loan at ${money(maxLoan)}` : undefined,
        maxLoan === undefined ? "Enter the car's price first." : `Up to ${money(maxLoan)} (${omv <= 20000 ? "70" : "60"}% of price).`,
      ),
      field(
        "Tenure",
        h("select", { onchange: (e: Event) => set("tenureMonths", Number((e.target as HTMLSelectElement).value)) }, ...[12, 24, 36, 48, 60, 72, 84].filter((m) => m <= maxTenure).map((m) => h("option", { value: m, selected: tenure === m }, `${m / 12} years`))),
        undefined,
        maxTenure < 84 ? "No longer than the COE it has left." : undefined,
      ),
      field("Flat rate", h("select", { onchange: (e: Event) => set("flatRate", Number((e.target as HTMLSelectElement).value)) }, ...rateOptions.map((r) => h("option", { value: r.flatRate, selected: Math.abs(state.flatRate - r.flatRate) < 1e-9 }, `${(r.flatRate * 100).toFixed(2)}% — ${r.lender}`))), undefined, `Banks' own pages, checked ${longDate(bankRates.checked)}.`),
    ],
    results: [
      h("div", { class: "kicker" }, "Loan"),
      plan && loan !== undefined ? h("div", { class: "big" }, `${money(plan.monthlyInstalmentCents / 100)} a month`) : h("div", { class: "big" }, "—"),
      plan && loan !== undefined
        ? h("p", { class: "sub" }, `${money(loan)} over ${tenure / 12} years. Total interest ${money(plan.totalInterestCents / 100)}. Effective rate ${(plan.effectiveRate * 100).toFixed(2)}% a year (${(state.flatRate * 100).toFixed(2)}% flat).`)
        : h("p", { class: "sub" }, "Enter the car's price to work out the loan."),
    ],
  };
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
