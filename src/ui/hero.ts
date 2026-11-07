/**
 * The top of the page: two inputs, the answer, and a slider to try other months.
 * Dragging the slider redraws only the readouts and the chart, so the slider keeps its grip.
 */
import * as Plot from "@observablehq/plot";
import type { RuleSet } from "../rules/index";
import type { Radar } from "../model/radar";
import { buyPoints, decide, REPAIRS_FROM_AGE, supplyAt, TYPICAL_ROAD_TAX, yearsBetween, type Decision, type NewCarCost, type SupplyReading } from "./decision";
import { h, longDate, money, monthLabel, signedMoney } from "./dom";
import { latestPqp, latestPremium, premiumRange } from "./data";
import { carName, premiumAt, presetById, type NextCarState } from "./nextCar";
import type { ValidCar } from "./profile";

export interface HeroContext {
  rules: RuleSet;
  today: string;
  nextCar: NextCarState;
  /** Supply radar for the next car's category. */
  radar: Radar;
  width: number;
  /** Changes the next car's settings; here, only the assumptions. */
  onNextCar: (s: NextCarState) => void;
}

const monthOf = (date: string) => monthLabel(date.slice(0, 7));
const capitalised = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** The answer for an owner: countdown, verdict, plan bars, and the "switch in" slider. */
export function ownerAnswer(valid: ValidCar, example: boolean, ctx: HeroContext, switchAt: string | undefined, onSwitch: (date: string) => void): HTMLElement {
  const { car } = valid;
  const pqp = latestPqp(ctx.rules.renewalCategory(car));
  const d = decide(car, ctx.nextCar, ctx.rules, ctx.today, pqp.pqp);
  const now = d.points[0]!;
  const atExpiry = d.points.at(-1)!;
  const months = Math.round(yearsBetween(ctx.today, car.coeExpiryDate) * 12);
  const name = carName(ctx.nextCar);
  const Name = capitalised(name);

  const plans = [
    { id: "now", title: "Switch now", detail: `${Name} today`, perYear: now.perYear },
    ...(d.points.length > 1 ? [{ id: "expiry", title: "Keep it to expiry, then switch", detail: `${Name} in ${monthOf(atExpiry.date)}`, perYear: atExpiry.perYear }] : []),
    ...[...d.renewals]
      .sort((a, b) => a.termYears - b.termYears)
      .map((r) => ({
        id: `renew${r.termYears}`,
        title: `Renew ${r.termYears} years, then switch`,
        detail: `${money(r.renewalCost)} to renew${d.paybackAtExpiry ? `, and the ${money(d.paybackAtExpiry)} LTA would pay at expiry is gone` : ""}; ${name} in ${monthOf(r.until)}`,
        perYear: r.perYear,
      })),
  ];
  const horizon = [atExpiry.date, ...d.renewals.map((r) => r.until)].sort().at(-1)!;
  const bestId = !d.best ? undefined : d.best.kind === "renew" ? `renew${d.best.plan.termYears}` : d.best.point === now ? "now" : d.best.point === atExpiry ? "expiry" : undefined;

  return h(
    "div",
    { class: "answer-wrap" },
    h(
      "div",
      { class: "answer" },
      h(
        "div",
        { class: "countdown" },
        h("div", { class: "kicker" }, example ? h("span", { class: "tag" }, "Example car") : null, `Your Cat ${car.category} COE`),
        h("div", { class: "huge" }, months >= 1 ? `${months} month${months === 1 ? "" : "s"}` : "Days"),
        h("p", { class: "sub" }, `left. It expires ${longDate(car.coeExpiryDate)}.`),
        h("p", { class: "sub" }, `Deregister today and LTA pays back ${money(now.payback)}.`),
      ),
      h(
        "div",
        { class: "verdict" },
        h("p", { class: "verdict-line" }, ...verdict(d, now, atExpiry, ctx.nextCar.premiumTrend)),
        d.best ? bars(plans, bestId) : null,
        d.best ? repairLine(d, ctx.nextCar.repairRise) : null,
        d.best
          ? h(
              "p",
              { class: "hint" },
              "Cost per year of road access, in today's dollars, counting the repairs and road tax surcharge that come with an older car. Excludes fuel and insurance. The assumptions are below.",
              [...d.points, ...d.renewals].some((x) => x.newCar?.assumed) ? " No VES or EEAI has been announced after 2027, so a new car bought later is priced with none." : "",
            )
          : null,
      ),
    ),
    d.best ? assumptions(ctx, presetById(ctx.nextCar.presetId).category as "A" | "B", horizon, ctx.rules.renewalCategory(car)) : null,
    d.points.length > 1 ? switchExplorer(d, ctx, switchAt, onSwitch) : null,
  );
}

/** "If premiums keep pace with inflation", "If premiums beat inflation by 3% a year". */
export function premise(trend: number): string {
  const pct = Math.round(Math.abs(trend) * 100);
  return pct === 0 ? "If premiums keep pace with inflation" : `If premiums ${trend > 0 ? "beat" : "trail"} inflation by ${pct}% a year`;
}

/** Within 3% of each other: closer than the assumptions behind them. */
const close = (a: number, b: number) => Math.abs(a - b) <= 0.03 * Math.min(a, b);

function verdict(d: Decision, now: Decision["points"][number], atExpiry: Decision["points"][number], trend: number): (string | Node)[] {
  if (!d.best) return ["Enter a price for your next car (below) to compare plans."];
  const strong = (s: string) => h("strong", {}, s);
  const lead = `${premise(trend)}, `;
  const cheapest = <T extends { perYear?: number }>(xs: T[]) => xs.filter((x) => x.perYear !== undefined).reduce<T | undefined>((a, x) => (!a || x.perYear! < a.perYear! ? x : a), undefined);
  const switchName = (p: Decision["points"][number]) => (p === now ? "switching now" : p === atExpiry ? "switching when your COE expires" : `switching in ${monthOf(p.date)}`);
  const bestSwitch = cheapest(d.points)!;
  const bestRenew = cheapest(d.renewals);
  if (d.best.kind === "renew") {
    const p = d.best.plan;
    if (close(p.perYear!, bestSwitch.perYear!))
      return [lead, strong(`renewing for ${p.termYears} years`), " and ", strong(switchName(bestSwitch)), ` cost about the same: ${money(p.perYear!)} and ${money(bestSwitch.perYear!)} a year. That's closer than the assumptions below, so it comes down to how much you trust a car past 10 years old.`];
    return [lead, strong(`renewing for ${p.termYears} years`), ` is the cheapest way to keep driving: ${money(p.perYear!)} a year, against ${money(bestSwitch.perYear!)} for ${switchName(bestSwitch)}.`];
  }
  const p = d.best.point;
  const when = p === now ? "switching now" : p === atExpiry ? "keeping your car until its COE expires" : `switching in ${monthOf(p.date)}`;
  if (bestRenew && close(p.perYear!, bestRenew.perYear!))
    return [lead, strong(when), ` is cheapest, but only just: ${money(p.perYear!)} a year, against ${money(bestRenew.perYear!)} for renewing ${bestRenew.termYears} years.`];
  if (p === now) return [lead, strong("switching now"), ` is cheapest: ${money(p.perYear!)} a year.`];
  return [lead, strong(when), ` is cheapest: ${money(p.perYear!)} a year, against ${money(now.perYear!)} for switching now.`];
}

/** How fast repairs would have to climb to change the answer between renewing and switching. */
function repairLine(d: Decision, assumed: number): HTMLElement | null {
  if (d.repairBreakEven === undefined) return null;
  const at = h("strong", {}, `${money(Math.round(d.repairBreakEven / 10) * 10)} a year`);
  const tail = ` for each year past ${REPAIRS_FROM_AGE} (assumed: ${money(assumed)}).`;
  return d.best?.kind === "renew"
    ? h("p", { class: "break-even" }, "Renewing stays cheapest only while your repair bills climb by less than ", at, tail, " Faster than that, switching wins.")
    : h("p", { class: "break-even" }, "Renewing would be cheapest if repair bills climbed by less than ", at, tail);
}

/** The forecasts the visitor makes: premiums, repairs, road tax, interest and inflation. Every plan above is rerun on change. */
function assumptions(ctx: HeroContext, category: "A" | "B", horizon: string, roadTaxCategory?: "A" | "B"): HTMLElement {
  const s = ctx.nextCar;
  const set = (patch: Partial<NextCarState>) => ctx.onNextCar({ ...s, ...patch });
  const since = `${Number(ctx.today.slice(0, 4)) - 10}${ctx.today.slice(4, 7)}`;
  const range = premiumRange(category, since);
  const premiumValue = h("strong", {}, "");
  const premiumNote = h("p", { class: "hint" }, "");
  const showPremium = (trend: number) => {
    premiumValue.textContent = premise(trend).replace(/^If premiums /, "");
    premiumNote.textContent =
      (trend ? `Cat ${category} would be about ${money(premiumAt(category, ctx.today, horizon, trend))} in today's dollars by ${monthOf(horizon)}, against ${money(latestPremium(category))} now. ` : `Cat ${category} is ${money(latestPremium(category))} now. `) +
      `Over the past 10 years it has run from ${money(range.low.premium)} (${monthLabel(range.low.month)}) to ${money(range.high.premium)} (${monthLabel(range.high.month)}).`;
  };
  showPremium(s.premiumTrend);

  const repairValue = h("strong", {}, "");
  const repairNote = h("p", { class: "hint" }, "");
  const showRepairs = (rise: number) => {
    repairValue.textContent = `${money(rise)} a year more for each year past ${REPAIRS_FROM_AGE}`;
    repairNote.textContent = rise
      ? `So a car costs ${money(rise * 5)} a year more to keep running at 10 years old than a new one, ${money(rise * 10)} at 15 and ${money(rise * 15)} at 20. Most of that lands on the years a renewal adds.`
      : "Repairs left out: an old car costs the same to run as a new one.";
  };
  showRepairs(s.repairRise);

  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const rateSelect = (name: "interest" | "inflation", max: number) =>
    h(
      "select",
      { name, onchange: (e: Event) => set({ [name]: Number((e.target as HTMLSelectElement).value) / 100 }) },
      ...Array.from({ length: max * 2 + 1 }, (_, k) => k / 2).map((v) => h("option", { value: v, selected: Math.abs(s[name] * 100 - v) < 1e-9 }, `${v}%`)),
    );

  return h(
    "div",
    { class: "trend" },
    h("div", { class: "kicker" }, "COE premiums from here: ", premiumValue),
    h(
      "div",
      { class: "slider" },
      h("span", { class: "hint" }, "−10%/yr"),
      h("input", {
        type: "range",
        name: "premiumTrend",
        min: -10,
        max: 10,
        step: 1,
        value: Math.round(s.premiumTrend * 100),
        "aria-label": "Yearly change in COE premiums, after inflation",
        oninput: (e: Event) => showPremium(Number((e.target as HTMLInputElement).value) / 100),
        onchange: (e: Event) => set({ premiumTrend: Number((e.target as HTMLInputElement).value) / 100 }),
      }),
      h("span", { class: "hint" }, "+10%/yr"),
    ),
    premiumNote,
    h("div", { class: "kicker" }, "Repairs: ", repairValue),
    h(
      "div",
      { class: "slider" },
      h("span", { class: "hint" }, "$0"),
      h("input", {
        type: "range",
        name: "repairRise",
        min: 0,
        max: 1000,
        step: 50,
        value: s.repairRise,
        "aria-label": "Extra repairs a year for each year a car is past 5 years old",
        oninput: (e: Event) => showRepairs(Number((e.target as HTMLInputElement).value)),
        onchange: (e: Event) => set({ repairRise: Number((e.target as HTMLInputElement).value) }),
      }),
      h("span", { class: "hint" }, "$1,000"),
    ),
    repairNote,
    h(
      "div",
      { class: "money-row" },
      roadTaxCategory
        ? h(
            "label",
            {},
            "Your road tax a year ",
            h("input", { name: "roadTax", inputmode: "numeric", value: s.roadTax, placeholder: String(TYPICAL_ROAD_TAX[roadTaxCategory]), size: 7, onchange: (e: Event) => set({ roadTax: (e.target as HTMLInputElement).value }) }),
          )
        : null,
      h("label", {}, "Interest ", rateSelect("interest", 8)),
      h("label", {}, "Inflation ", rateSelect("inflation", 5)),
    ),
    h(
      "p",
      { class: "hint" },
      roadTaxCategory ? `Road tax: blank takes a typical Cat ${roadTaxCategory} petrol car's ${money(TYPICAL_ROAD_TAX[roadTaxCategory])}; LTA adds 10% once a car is past 10 years old, rising to 50% past 14. ` : "",
      `Interest is what your money earns, or what a loan costs. Car prices and renewal costs keep pace with inflation; what LTA pays back is a fixed dollar amount, so inflation eats into it. With interest at ${pct(s.interest)} and inflation at ${pct(s.inflation)}, money spent later costs ${s.interest >= s.inflation ? "less" : "more"} in today's dollars.`,
    ),
  );
}

function bars(plans: { id: string; title: string; detail: string; perYear?: number }[], bestId: string | undefined): HTMLElement {
  const max = Math.max(...plans.map((p) => p.perYear ?? 0));
  return h(
    "ul",
    { class: "bars" },
    ...plans.map((p) =>
      h(
        "li",
        { class: p.id === bestId ? "best" : "" },
        h("div", { class: "bar-label" }, h("strong", {}, p.title), p.id === bestId ? h("span", { class: "tag" }, "cheapest") : null, h("span", { class: "hint" }, p.detail)),
        h("div", { class: "bar-track" }, h("div", { class: "bar", style: `width:${(((p.perYear ?? 0) / max) * 100).toFixed(1)}%` })),
        h("div", { class: "bar-value" }, p.perYear === undefined ? "—" : `${money(p.perYear)}/yr`),
      ),
    ),
  );
}

function supplyLine(radar: Radar, today: string, date: string, category: string): string | undefined {
  const at = supplyAt(radar, date);
  const base = supplyAt(radar, today);
  if (!at || !base) return undefined;
  const change = Math.round((at.quota / base.quota - 1) * 100);
  return `${at.quota.toLocaleString("en-SG")} Cat ${category} COEs a quarter${at.projected ? " (projected)" : ""}, ${change === 0 ? "the same as" : `${change > 0 ? "+" : ""}${change}% on`} this quarter`;
}

function supplyReadout(r: SupplyReading | undefined): string {
  return r ? `${monthLabel(r.quarterStart)} quarter` : "";
}

/** What moves the next car's price between today and its purchase date. */
function priceNote(c: NewCarCost | undefined): string {
  if (!c) return "";
  const parts = [
    c.premiumChange ? `premium ${signedMoney(c.premiumChange)}` : "",
    c.arfChange ? `ARF and VES ${signedMoney(c.arfChange)}${c.assumed ? " (no VES or EEAI announced after 2027: assumed none)" : ""}` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")} vs buying today.` : "Same as buying today.";
}

function switchExplorer(d: Decision, ctx: HeroContext, switchAt: string | undefined, onSwitch: (date: string) => void): HTMLElement {
  const category = presetById(ctx.nextCar.presetId).category;
  const bestSwitch = d.best?.kind === "switch" ? d.points.indexOf(d.best.point) : -1;
  let index = switchAt ? d.points.findIndex((p) => p.date === switchAt) : -1;
  if (index < 0) index = bestSwitch >= 0 ? bestSwitch : d.points.length - 1;

  const heading = h("h3", {}, "");
  const readouts = h("div", { class: "readouts" });
  const chart = h("figure", { class: "chart" });
  const draw = () => {
    const p = d.points[index]!;
    heading.replaceChildren("What if you switch in ", h("strong", {}, monthOf(p.date)), "?");
    readouts.replaceChildren(
      readout("LTA pays you back", money(p.payback), index === 0 ? "PARF + COE rebate, today" : `${money(p.waitCost)} less than today: the cost of keeping it till then`),
      readout("Next car", p.newCar ? money(p.newCar.price) : "—", priceNote(p.newCar)),
      readout(`Cat ${category} supply`, supplyAt(ctx.radar, p.date)?.quota.toLocaleString("en-SG") ?? "—", supplyLine(ctx.radar, ctx.today, p.date, category) ?? "", supplyReadout(supplyAt(ctx.radar, p.date))),
      readout("All in", p.perYear === undefined ? "—" : `${money(p.perYear)}/yr`, `Over ${(yearsBetween(ctx.today, p.date) + d.holdingYears).toFixed(1)} years of driving`),
    );
    chart.replaceChildren(switchChart(d, index, ctx.width));
  };
  const slider = h("input", {
    type: "range",
    name: "switchAt",
    min: 0,
    max: d.points.length - 1,
    step: 1,
    value: index,
    "aria-label": "Month you switch",
    oninput: (e: Event) => {
      index = Number((e.target as HTMLInputElement).value);
      draw();
    },
    onchange: () => onSwitch(d.points[index]!.date),
  });
  draw();
  return h(
    "div",
    { class: "explore" },
    heading,
    h("div", { class: "slider" }, h("span", { class: "hint" }, "Now"), slider, h("span", { class: "hint" }, "Expiry")),
    readouts,
    chart,
    h(
      "ul",
      { class: "legend" },
      h("li", {}, h("span", { class: "sw line" }), "Switch in that month"),
      d.renewals.length ? h("li", {}, h("span", { class: "sw dash" }), "Renew, then switch (doesn't depend on the slider)") : null,
    ),
  );
}

function readout(label: string, value: string, note: string, extra = ""): HTMLElement {
  return h("div", { class: "readout" }, h("div", { class: "kicker" }, label, extra ? ` · ${extra}` : ""), h("div", { class: "big" }, value), h("p", { class: "hint" }, note));
}

function switchChart(d: Decision, index: number, width: number): SVGSVGElement | HTMLElement {
  const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const rows = d.points.filter((p) => p.perYear !== undefined).map((p) => ({ date: toDate(p.date), perYear: p.perYear! }));
  if (!rows.length) return h("p", { class: "hint" }, "");
  let renew = d.renewals.filter((r) => r.perYear !== undefined).map((r) => ({ label: `Renew ${r.termYears}, then switch`, perYear: r.perYear! }));
  // Two renewals a few percent apart would print their labels on top of each other: label them once.
  const all = [...rows.map((r) => r.perYear), ...renew.map((r) => r.perYear)];
  if (renew.length === 2 && Math.abs(renew[0]!.perYear - renew[1]!.perYear) < 0.06 * (Math.max(...all) - Math.min(...all)))
    renew = [{ label: "Renew 5 or 10, then switch", perYear: Math.min(renew[0]!.perYear, renew[1]!.perYear) }, { label: "", perYear: Math.max(renew[0]!.perYear, renew[1]!.perYear) }];
  const picked = d.points[index]!;
  const end = rows.at(-1)!.date;
  return Plot.plot({
    width,
    height: 210,
    marginLeft: 56,
    marginBottom: 36,
    marginRight: width < 600 ? 12 : 150,
    x: { type: "utc", label: null },
    y: { label: "Cost per year", grid: false, tickFormat: (v: number) => money(v), nice: true },
    style: { background: "transparent", color: "var(--ink)", fontSize: "12px" },
    marks: [
      Plot.gridY({ strokeOpacity: 0.12 }),
      Plot.ruleY(renew, { y: "perYear", stroke: "var(--p1)", strokeDasharray: "4,3" }),
      width < 600
        ? Plot.text(renew, { y: "perYear", frameAnchor: "left", text: "label", dy: -7, dx: 4, textAnchor: "start", fill: "var(--ink)", fontSize: 10 })
        : Plot.text(renew, { x: () => end, y: "perYear", text: "label", dx: 8, textAnchor: "start", fill: "var(--ink)", fontSize: 11 }),
      Plot.lineY(rows, { x: "date", y: "perYear", stroke: "var(--accent)", strokeWidth: 2.5, curve: "step-after" }),
      picked.perYear !== undefined ? Plot.dot([{ date: toDate(picked.date), perYear: picked.perYear }], { x: "date", y: "perYear", r: 6, fill: "var(--accent)", stroke: "var(--card)", strokeWidth: 2 }) : null,
      Plot.tip(rows, Plot.pointerX({ x: "date", y: "perYear", title: (r) => `Switch ${longDate(r.date.toISOString().slice(0, 10))}\n${money(r.perYear)} a year` })),
    ].filter(Boolean) as Plot.Markish[],
  });
}

/** The answer for a first-time buyer: cost per year of the chosen car, by buying month. */
export function buyerAnswer(targetMonth: string | undefined, ctx: HeroContext, onMonth: (month: string) => void): HTMLElement {
  const preset = presetById(ctx.nextCar.presetId);
  const points = buyPoints(ctx.nextCar, ctx.rules, ctx.today);
  if (points[0]!.newCar === undefined)
    return h("div", { class: "answer-wrap" }, h("p", { class: "verdict-line" }, `LTA's table has no price for the ${preset.label}. Enter a price below to see what it costs a year.`));
  let index = targetMonth ? points.findIndex((p) => p.date.slice(0, 7) === targetMonth) : 0;
  if (index < 0) index = 0;

  const cheapest = points.reduce((a, p) => (p.perYear! < a.perYear! ? p : a));
  const main = h("div", { class: "answer" });
  const readouts = h("div", { class: "readouts" });
  const chart = h("figure", { class: "chart" });
  const heading = h("h3", {}, "");
  const draw = () => {
    const p = points[index]!;
    main.replaceChildren(
      h(
        "div",
        { class: "countdown" },
        h("div", { class: "kicker" }, `${capitalised(carName(ctx.nextCar))}, bought ${monthOf(p.date)}`),
        h("div", { class: "huge" }, `${money(p.perYear!)}/yr`),
        h(
          "p",
          { class: "sub" },
          `for ${p.newCar!.years} years of driving: ${money(p.newCar!.price)} less ${money(p.newCar!.resale)} back ${ctx.nextCar.kind === "used" ? "from LTA when its COE runs out" : "when you sell"}.`,
        ),
      ),
      h(
        "div",
        { class: "verdict" },
        h(
          "p",
          { class: "verdict-line" },
          // Under $100 a year is rounding in the dates, not a reason to wait.
          ...(cheapest.perYear! <= p.perYear! - 100
            ? [
                `${premise(ctx.nextCar.premiumTrend)}, buying in `,
                h("strong", {}, monthOf(cheapest.date)),
                ` would be ${money(p.perYear! - cheapest.perYear!)} a year cheaper`,
                cheapest.newCar!.arfChange !== p.newCar!.arfChange ? `, partly from the ARF and VES rules in force then${cheapest.newCar!.assumed ? " (no VES or EEAI has been announced after 2027, so none is assumed)" : ""}.` : ".",
              ]
            : [`${premise(ctx.nextCar.premiumTrend)}, no month in the next three years is cheaper for this car.`]),
        ),
        h("p", { class: "hint" }, "In today's dollars, counting repairs as the car ages. Excludes fuel and insurance. The loan is worked out under Your next car."),
      ),
    );
    heading.replaceChildren("What if you buy in ", h("strong", {}, monthOf(p.date)), "?");
    readouts.replaceChildren(
      readout("Price", money(p.newCar!.price), priceNote(p.newCar)),
      readout(`Cat ${preset.category} supply`, supplyAt(ctx.radar, p.date)?.quota.toLocaleString("en-SG") ?? "—", supplyLine(ctx.radar, ctx.today, p.date, preset.category) ?? "", supplyReadout(supplyAt(ctx.radar, p.date))),
    );
    const rows = points.map((q) => ({ date: new Date(`${q.date}T00:00:00Z`), perYear: q.perYear! }));
    chart.replaceChildren(
      Plot.plot({
        width: ctx.width,
        height: 190,
        marginLeft: 56,
        marginBottom: 36,
        x: { type: "utc", label: null },
        y: { label: "Cost per year", grid: false, tickFormat: (v: number) => money(v), nice: true },
        style: { background: "transparent", color: "var(--ink)", fontSize: "12px" },
        marks: [
          Plot.gridY({ strokeOpacity: 0.12 }),
          Plot.lineY(rows, { x: "date", y: "perYear", stroke: "var(--accent)", strokeWidth: 2.5, curve: "step-after" }),
          Plot.dot([rows[index]!], { x: "date", y: "perYear", r: 6, fill: "var(--accent)", stroke: "var(--card)", strokeWidth: 2 }),
          Plot.tip(rows, Plot.pointerX({ x: "date", y: "perYear", title: (r) => `Buy ${monthOf(r.date.toISOString().slice(0, 10))}\n${money(r.perYear)} a year` })),
        ],
      }),
    );
  };
  const slider = h("input", {
    type: "range",
    name: "buyAt",
    min: 0,
    max: points.length - 1,
    step: 1,
    value: index,
    "aria-label": "Month you buy",
    oninput: (e: Event) => {
      index = Number((e.target as HTMLInputElement).value);
      draw();
    },
    onchange: () => onMonth(points[index]!.date.slice(0, 7)),
  });
  draw();
  return h(
    "div",
    { class: "answer-wrap" },
    main,
    h("div", { class: "explore" }, heading, h("div", { class: "slider" }, h("span", { class: "hint" }, "Now"), slider, h("span", { class: "hint" }, "+3 years")), readouts, chart),
    assumptions(ctx, preset.category as "A" | "B", points.at(-1)!.date),
  );
}
