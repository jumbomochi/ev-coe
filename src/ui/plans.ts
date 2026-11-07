/**
 * Section 4: what each plan would have cost someone with your deadline, replayed on real COE history.
 * Drawn against the deadline date, under the premium history, so it shows *when* a plan paid off:
 * renewing wins when premiums fall over the next five years and loses when they rise.
 */
import * as Plot from "@observablehq/plot";
import type { Strip } from "../model/backtest";
import { exerciseDate } from "../model/premiums";
import type { Exercise } from "../rules/index";
import { history } from "./data";
import { h, longDate, method, money, signedMoney } from "./dom";

const TITLES: Record<Strip["plan"], string> = {
  "buy-at-deadline": "Buy when your COE expires",
  "renew-5-then-buy": "Renew 5 years, then buy",
  "buy-a-year-early": "Buy a year early",
  "first-car": "Buy in your target month",
};
/** Line colour per plan, fixed so a plan keeps its colour whichever plans are shown. */
const STROKE: Partial<Record<Strip["plan"], string>> = { "renew-5-then-buy": "var(--p1)", "buy-a-year-early": "var(--p2)", "first-car": "var(--accent)" };
const SWATCH: Partial<Record<Strip["plan"], string>> = { "renew-5-then-buy": "p1", "buy-a-year-early": "p2", "first-car": "accent" };
const FROM = "2010-01-01";
const GERUND: Partial<Record<Strip["plan"], string>> = { "renew-5-then-buy": "renewing for 5 years", "buy-a-year-early": "buying a year early" };

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const key = (e: Exercise) => `${e.month}/${e.bidding}`;
const fmt = (s: Strip, v: number) => (s.relative ? signedMoney(v) : money(v));

export interface PlansContext {
  category: "A" | "B";
  today: string;
  /** The visitor's COE expiry or target month, if known. */
  deadline?: string;
}

export function plansSection(strips: Strip[], width: number, referenceLabel: string, ctx: PlansContext): HTMLElement {
  const first = strips[0]!;
  const firstCar = first.plan === "first-car";
  // The chart compares plans with buying at expiry; buying at expiry itself is the baseline at $0.
  const lines = firstCar ? strips : strips.filter((s) => s.relative);
  const exercises = history.exercises();
  const startKey = key(first.outcomes[0]!.start);
  const endKey = key(first.outcomes.at(-1)!.start);
  const span = exercises.slice(
    exercises.findIndex((e) => key(e) === startKey),
    exercises.findIndex((e) => key(e) === endKey) + 1,
  );

  // One row per exercise in the replayed span; NaN where a plan has no result, so lines break there.
  const values = lines.map((s) => new Map(s.outcomes.map((o) => [key(o.start), o.value])));
  const rows = span.map((e) => ({ date: toDate(exerciseDate(e)), exercise: e, v: values.map((m) => m.get(key(e)) ?? NaN) }));
  const crossing = runs(first.outcomes.filter((o) => o.crossesBoundary).map((o) => o.start), span);

  const latest = exercises.at(-1)!;
  const xEnd = toDate([ctx.deadline, ctx.today].filter((d): d is string => !!d).sort().at(-1)!);
  xEnd.setUTCMonth(xEnd.getUTCMonth() + 6);
  const x = { type: "utc" as const, label: null, domain: [toDate(FROM), xEnd] };
  const narrow = width < 600;
  const style = { background: "transparent", color: "var(--ink)", fontSize: "12px" };
  const spanRect = [{ from: rows[0]!.date, to: rows.at(-1)!.date }];
  // "Today" sits left of its line and the deadline right of its own, so they never collide.
  const markers = [
    { date: toDate(ctx.today), label: "Today", anchor: "end", dx: -4 },
    ...(ctx.deadline && ctx.deadline > ctx.today ? [{ date: toDate(ctx.deadline), label: firstCar ? "Your month" : narrow ? "Deadline" : "Your deadline", anchor: "start", dx: 4 }] : []),
  ];
  const markerMarks = (labelled: boolean): Plot.Markish[] => [
    Plot.ruleX(markers, { x: "date", stroke: "var(--ink)", strokeDasharray: "2,3" }),
    ...(labelled
      ? markers.map((m) => Plot.text([m], { x: "date", frameAnchor: "bottom", text: "label", textAnchor: m.anchor as "start" | "end", dx: m.dx, dy: -4, fill: "var(--ink)", fontSize: 10 }))
      : []),
  ];

  // Top: the premium that drove every result, over the replayed deadlines and the years after them.
  const premiums = exercises.filter((e) => e.month >= FROM.slice(0, 7)).map((e) => ({ date: toDate(exerciseDate(e)), premium: history.premium(e, ctx.category) ?? NaN }));
  const premiumChart = firstCar ? null : Plot.plot({
    width,
    height: 170,
    marginLeft: 56,
    marginRight: 56,
    x,
    y: { label: `Cat ${ctx.category} premium`, grid: false, tickFormat: "~s" },
    style,
    marks: [
      Plot.gridY({ strokeOpacity: 0.12 }),
      Plot.rectX(spanRect, { x1: "from", x2: "to", fill: "var(--muted)", fillOpacity: 0.08 }),
      Plot.text(spanRect, { x: (d) => new Date((d.from.getTime() + d.to.getTime()) / 2), frameAnchor: "top", dy: 4, text: () => "Deadlines replayed", fill: "var(--muted)", fontSize: 10 }),
      Plot.lineY(premiums, { x: "date", y: "premium", stroke: ctx.category === "A" ? "var(--s1)" : "var(--s2)", strokeWidth: 1.5 }),
      ...markerMarks(true),
      Plot.ruleY([0]),
      Plot.tip(premiums, Plot.pointerX({ x: "date", y: "premium", title: (d) => `${longDate(d.date.toISOString().slice(0, 10))}\nCat ${ctx.category} ${money(d.premium)}` })),
    ],
  });

  // Bottom: each plan's result against the date it was replayed from.
  const yLabel = firstCar ? "Cost per year of road access" : "Cost per year vs buying at expiry";
  const all = rows.flatMap((r) => r.v).filter((v) => !Number.isNaN(v));
  const ends = lines.map((_s, i) => [...rows].reverse().find((r) => !Number.isNaN(r.v[i]!)));
  const resultChart = Plot.plot({
    width,
    height: 240,
    marginLeft: 56,
    marginRight: 56,
    x,
    y: { label: yLabel, grid: false, tickFormat: (d: number) => (firstCar ? money(d) : signedMoney(d)), domain: [Math.min(0, ...all), Math.max(0, ...all)], nice: true },
    style,
    marks: [
      Plot.gridY({ strokeOpacity: 0.12 }),
      Plot.rectX(crossing, { x1: "from", x2: "to", fill: "var(--muted)", fillOpacity: 0.12 }),
      Plot.text(crossing, { x: (d) => new Date((d.from.getTime() + d.to.getTime()) / 2), frameAnchor: "bottom", dy: -4, text: () => "Spans a Cat A/B rule change", fill: "var(--muted)", fontSize: 10 }),
      // Explain the sign in the empty years after the last replayed deadline.
      firstCar || narrow
        ? null
        : Plot.text(["↑ Above $0: cost more than buying at expiry", "↓ Below $0: cheaper"], {
            x: () => new Date(rows.at(-1)!.date.getTime() + 0.55 * (xEnd.getTime() - rows.at(-1)!.date.getTime())),
            y: (_d, i) => (i === 0 ? Math.max(...all) / 2 : Math.min(...all) / 2),
            text: (d) => d,
            lineWidth: 9,
            fill: "var(--muted)",
            fontSize: 10,
          }),
      Plot.ruleY([0], { stroke: firstCar ? "var(--ink)" : "var(--muted)" }),
      // Faint: every exercise. Bold: a 3-month average, which carries the trend.
      ...lines.map((s, i) => Plot.lineY(rows, { x: "date", y: (r) => r.v[i], stroke: STROKE[s.plan], strokeWidth: 1, strokeOpacity: 0.35 })),
      ...lines.map((s, i) => Plot.lineY(rows, Plot.windowY({ k: 6, reduce: "mean" }, { x: "date", y: (r: (typeof rows)[number]) => r.v[i], stroke: STROKE[s.plan], strokeWidth: 2.5 }))),
      ...lines.map((s, i) =>
        Plot.text(ends[i] ? [ends[i]] : [], { x: "date", y: (r) => r.v[i], text: () => (firstCar ? "" : shortTitle(s.plan)), textAnchor: "start", dx: 6, fill: "var(--ink)", fontSize: 11 }),
      ),
      ...markerMarks(firstCar),
      Plot.ruleX(rows, Plot.pointerX({ x: "date", stroke: "var(--muted)", strokeOpacity: 0.5 })),
      Plot.tip(
        rows,
        Plot.pointerX({
          x: "date",
          y: (r: (typeof rows)[number]) => Math.max(...r.v.filter((v) => !Number.isNaN(v)), 0),
          title: (r: (typeof rows)[number]) =>
            [`${firstCar ? "Buying" : "COE expiring"} ${longDate(exerciseDate(r.exercise))}`, ...lines.map((s, i) => `${TITLES[s.plan]}: ${Number.isNaN(r.v[i]!) ? "no result" : `${fmt(s, r.v[i]!)} a year`}`)].join("\n"),
        }),
      ),
    ].filter(Boolean) as Plot.Markish[],
  });

  return h(
    "div",
    {},
    h("h3", { class: "takeaway" }, takeaway(strips)),
    h(
      "p",
      { class: "sub" },
      firstCar
        ? "Each point treats one past bidding exercise as your buying month and works out the cost of 10 years of driving on the premiums people actually paid."
        : "Each point treats one past bidding exercise as the day your COE expired and replays the plan on the premiums people actually paid.",
    ),
    h(
      "div",
      { class: "tiles" },
      ...strips.map((s) =>
        h(
          "div",
          { class: "tile" },
          h("h3", {}, SWATCH[s.plan] ? h("span", { class: `sw line ${SWATCH[s.plan]}` }) : null, TITLES[s.plan]),
          h("div", { class: "big" }, `${fmt(s, s.median)} a year`),
          h("p", { class: "sub" }, s.relative ? "median, vs buying at expiry" : "median cost of road access"),
          h("p", { class: "hint" }, `10–90%: ${fmt(s, s.p10)} to ${fmt(s, s.p90)} · N = ${s.n}`),
        ),
      ),
    ),
    premiumChart ? h("figure", { class: "chart" }, premiumChart) : null,
    h("figure", { class: "chart" }, resultChart),
    h(
      "ul",
      { class: "legend" },
      ...lines.map((s) => h("li", {}, h("span", { class: `sw line ${SWATCH[s.plan]}` }), TITLES[s.plan])),
      firstCar ? null : h("li", {}, h("span", { class: "sw zero" }), "$0 = buying when your COE expires; above it the plan cost more, below it less"),
      crossing.length ? h("li", {}, h("span", { class: "sw shade" }), "Spans a change to which cars count as Cat A or B, so premiums either side aren't like for like") : null,
    ),
    firstCar
      ? null
      : h(
          "p",
          { class: "note" },
          "How to read it: renewing for 5 years means buying 5 years later at whatever the premium is then. It came out cheaper for deadlines at a premium peak (2012-14, when premiums then fell) and dearer for deadlines in a trough (2017-21, before premiums tripled). Buying a year early wins when premiums are rising.",
        ),
    method(
      h(
      "p",
      {},
      `This shows what happened, not what will happen. Replayed from ${longDate(exerciseDate(first.outcomes[0]!.start))} to ${longDate(exerciseDate(first.outcomes.at(-1)!.start))}; latest premium ${longDate(exerciseDate(latest))}. Neighbouring points share most of their years, so they are not independent trials. `,
      `Costs are COE premiums and PQP, plus the next car's ARF less the PARF it keeps (reference car: ${referenceLabel}), per year of road access, in nominal dollars, with today's rules applied to past prices. They exclude the car's price and depreciation, VES/EEAI timing, fuel and insurance.`,
      ),
    ),
  );
}

/** One sentence on what history says, from the medians. */
function takeaway(strips: Strip[]): string {
  const first = strips[0]!;
  if (first.plan === "first-car") return `Over ${first.n} past buying months, 10 years of road access cost a median ${money(first.median)} a year.`;
  const parts = strips
    .filter((s) => s.relative)
    .map((s) => `${GERUND[s.plan]} cost a median ${money(Math.abs(Math.round(s.median)))} a year ${s.median >= 0 ? "more" : "less"}`);
  return `Over ${first.n} past deadlines, ${parts.join(", and ")} than buying when the COE expired.`;
}

function shortTitle(plan: Strip["plan"]): string {
  return plan === "renew-5-then-buy" ? "Renew 5" : plan === "buy-a-year-early" ? "Year early" : "";
}

/** Contiguous runs of `marked` exercises within `span`, as date ranges. */
function runs(marked: Exercise[], span: Exercise[]): { from: Date; to: Date }[] {
  const set = new Set(marked.map(key));
  const out: { from: Date; to: Date }[] = [];
  let open: { from: Date; to: Date } | undefined;
  for (const e of span) {
    const d = toDate(exerciseDate(e));
    if (set.has(key(e))) {
      if (open) open.to = d;
      else out.push((open = { from: d, to: d }));
    } else open = undefined;
  }
  return out;
}
