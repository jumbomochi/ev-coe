/**
 * The top of the page: two inputs, the answer, and a slider to try other months.
 * Dragging the slider redraws only the readouts and the chart, so the slider keeps its grip.
 */
import * as Plot from "@observablehq/plot";
import type { RuleSet } from "../rules/index";
import type { Radar } from "../model/radar";
import { buyPoints, decide, supplyAt, yearsBetween, type Decision, type NewCarCost, type SupplyReading } from "./decision";
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
  /** Changes the next car's settings; here, only the premium trend. */
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
      .map((r) => ({ id: `renew${r.termYears}`, title: `Renew ${r.termYears} years, then switch`, detail: `${money(r.renewalCost)} to renew; ${name} in ${monthOf(r.until)}`, perYear: r.perYear })),
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
        d.upkeepBreakEven ? breakEven(d.upkeepBreakEven, atExpiry, now) : null,
        d.best
          ? h(
              "p",
              { class: "hint" },
              "Cost per year of road access. Car prices and renewal costs follow the premium setting below. Excludes repairs, fuel, insurance and loan interest.",
              [...d.points, ...d.renewals].some((x) => x.newCar?.assumed) ? " No VES or EEAI has been announced after 2027, so a new car bought later is priced with none." : "",
            )
          : null,
      ),
    ),
    d.best ? trendControl(ctx, presetById(ctx.nextCar.presetId).category as "A" | "B", horizon) : null,
    d.points.length > 1 ? switchExplorer(d, ctx, switchAt, onSwitch) : null,
  );
}

/** "If premiums stay at today's level", "If premiums rise 3% a year". */
export function premise(trend: number): string {
  const pct = Math.round(Math.abs(trend) * 100);
  return pct === 0 ? "If premiums stay at today's level" : `If premiums ${trend > 0 ? "rise" : "fall"} ${pct}% a year`;
}

function verdict(d: Decision, now: Decision["points"][number], atExpiry: Decision["points"][number], trend: number): (string | Node)[] {
  if (!d.best) return ["Enter a price for your next car (below) to compare plans."];
  const strong = (s: string) => h("strong", {}, s);
  const lead = `${premise(trend)}, `;
  if (d.best.kind === "renew") {
    const p = d.best.plan;
    return [lead, strong(`renewing for ${p.termYears} years`), ` is the cheapest way to keep driving: ${money(p.perYear!)} a year, against ${money(atExpiry.perYear!)} for switching when your COE expires.`];
  }
  const p = d.best.point;
  if (p === now) return [lead, strong("switching now"), ` is cheapest: ${money(p.perYear!)} a year.`];
  const when = p === atExpiry ? "keeping your car until its COE expires" : `switching in ${monthOf(p.date)}`;
  return [lead, strong(when), ` is cheapest: ${money(p.perYear!)} a year, against ${money(now.perYear!)} for switching now.`];
}

/** Renewing looks cheapest only because an older car's extra running costs are left out; say how much they'd have to be. */
function breakEven(b: NonNullable<Decision["upkeepBreakEven"]>, atExpiry: Decision["points"][number], now: Decision["points"][number]): HTMLElement {
  const switchWhen = b.versus === atExpiry ? "switching at expiry" : b.versus === now ? "switching now" : `switching in ${monthOf(b.versus.date)}`;
  return h(
    "p",
    { class: "break-even" },
    `Renewing wins only while your car, past 10 years old, costs less than `,
    h("strong", {}, `${money(b.perYear)} a year`),
    ` more to run than a newer one. That covers repairs and road tax, which rises by up to 50% for cars over 10 years old. Above that, ${switchWhen} is cheaper.`,
  );
}

/** The one forecast the visitor makes: where premiums go from here. Moves car prices, used values and renewal costs. */
function trendControl(ctx: HeroContext, category: "A" | "B", horizon: string): HTMLElement {
  const since = `${Number(ctx.today.slice(0, 4)) - 10}${ctx.today.slice(4, 7)}`;
  const range = premiumRange(category, since);
  const value = h("strong", {}, "");
  const note = h("p", { class: "hint" }, "");
  const show = (trend: number) => {
    value.textContent = premise(trend).replace(/^If premiums /, "");
    note.textContent =
      (trend ? `Cat ${category} would be about ${money(premiumAt(category, ctx.today, horizon, trend))} in ${monthOf(horizon)}, against ${money(latestPremium(category))} now. ` : `Cat ${category} is ${money(latestPremium(category))} now. `) +
      `Over the past 10 years it has run from ${money(range.low.premium)} (${monthLabel(range.low.month)}) to ${money(range.high.premium)} (${monthLabel(range.high.month)}).`;
  };
  show(ctx.nextCar.premiumTrend);
  return h(
    "div",
    { class: "trend" },
    h("div", { class: "kicker" }, "COE premiums from here: ", value),
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
        value: Math.round(ctx.nextCar.premiumTrend * 100),
        "aria-label": "Yearly change in COE premiums",
        oninput: (e: Event) => show(Number((e.target as HTMLInputElement).value) / 100),
        onchange: (e: Event) => ctx.onNextCar({ ...ctx.nextCar, premiumTrend: Number((e.target as HTMLInputElement).value) / 100 }),
      }),
      h("span", { class: "hint" }, "+10%/yr"),
    ),
    note,
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
  const renew = d.renewals.filter((r) => r.perYear !== undefined).map((r) => ({ label: `Renew ${r.termYears}, then switch`, perYear: r.perYear! }));
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
        h("p", { class: "hint" }, "Excludes fuel, insurance and loan interest. The loan is worked out under Your next car."),
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
    trendControl(ctx, preset.category as "A" | "B", points.at(-1)!.date),
  );
}
