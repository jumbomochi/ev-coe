/** Section 2, first half: COE premiums by category. The category sets the COE part of a car's price. */
import * as Plot from "@observablehq/plot";
import { exerciseDate } from "../model/premiums";
import { addMonths } from "../model/radar";
import type { Exercise } from "../rules/index";
import { history } from "./data";
import { h, longDate, method, money, signedMoney } from "./dom";

type Cat = "A" | "B" | "E";

export const CATEGORIES: { id: Cat; rule: string }[] = [
  { id: "A", rule: "Cars up to 1,600 cc and 97 kW; EVs up to 110 kW" },
  { id: "B", rule: "Cars above 1,600 cc or 97 kW; EVs above 110 kW" },
  { id: "E", rule: "Open: the COE can go on a car of either category" },
];
/** Series order is fixed by category, so a colour always means the same category. */
const STROKE: Record<Cat, string> = { A: "var(--s1)", B: "var(--s2)", E: "var(--s3)" };
const FROM_MONTH = "2018-01";
const isoToDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Moves end-of-line labels apart so none sits closer than `gap` to another. */
function spread(ys: number[], gap: number): number[] {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const out = [...ys];
  let prev = -Infinity;
  for (const [y, i] of order) out[i] = prev = Math.max(y, prev + gap);
  return out;
}

export function premiumsSection(highlight: "A" | "B", window: { from: string; to: string } | undefined, width: number): HTMLElement {
  const exercises = history.exercises();
  const latest = exercises.at(-1)!;
  const previous = exercises.at(-2)!;

  const tiles = h(
    "div",
    { class: "tiles" },
    ...CATEGORIES.map((c) => {
      const now = history.premium(latest, c.id)!;
      const before = history.premium(previous, c.id);
      return h(
        "div",
        { class: c.id === highlight ? "tile mine" : "tile" },
        h("div", { class: "kicker" }, h("span", { class: `sw s-${c.id}` }), `Cat ${c.id}`, c.id === highlight ? h("span", { class: "badge" }, "your next car") : null),
        h("div", { class: "big" }, money(now)),
        before !== undefined ? h("p", { class: "sub" }, `${signedMoney(now - before)} on the previous exercise`) : null,
        h("p", { class: "hint" }, c.rule),
      );
    }),
  );

  // Every exercise slot from FROM_MONTH, so months without bidding (Apr-Jun 2020) show as gaps.
  const slots: Exercise[] = [];
  for (let m = FROM_MONTH; m <= latest.month; m = addMonths(m, 1)) for (const bidding of [1, 2] as const) if (m < latest.month || bidding <= latest.bidding) slots.push({ month: m, bidding });
  const wide = slots.map((e) => ({ date: isoToDate(exerciseDate(e)), exercise: e, A: history.premium(e, "A"), B: history.premium(e, "B"), E: history.premium(e, "E") }));
  const values = wide.flatMap((d) => [d.A, d.B, d.E]).filter((v): v is number => v !== undefined);
  const yMax = Math.max(...values);
  const ends = CATEGORIES.map((c) => history.premium(latest, c.id)!);
  const labelYs = spread(ends, yMax * 0.07);
  const lastDate = isoToDate(exerciseDate(latest));

  const chart = Plot.plot({
    width,
    height: 260,
    marginLeft: 48,
    marginRight: 44,
    x: { type: "utc", label: null },
    y: { label: "Premium per exercise", grid: false, tickFormat: "~s", domain: [0, yMax * 1.05] },
    style: { background: "transparent", color: "var(--ink)", fontSize: "12px" },
    marks: [
      Plot.gridY({ strokeOpacity: 0.12 }),
      window ? Plot.rectX([window], { x1: (d) => isoToDate(d.from), x2: (d) => isoToDate(d.to), fill: "var(--accent)", fillOpacity: 0.1 }) : null,
      ...CATEGORIES.map((c) => Plot.lineY(wide, { x: "date", y: (d) => d[c.id] ?? NaN, stroke: STROKE[c.id], strokeWidth: c.id === highlight ? 2.5 : 1.5 })),
      Plot.text(CATEGORIES, { x: () => lastDate, y: (_d, i) => labelYs[i], text: (d) => `Cat ${d.id}`, textAnchor: "start", dx: 6, fill: "var(--ink)" }),
      Plot.ruleY([0]),
      Plot.ruleX(wide, Plot.pointerX({ x: "date", stroke: "var(--muted)", strokeOpacity: 0.5 })),
      Plot.tip(
        wide,
        Plot.pointerX({
          x: "date",
          y: (d) => Math.max(d.A ?? 0, d.B ?? 0, d.E ?? 0),
          title: (d) =>
            d.A === undefined
              ? `${longDate(exerciseDate(d.exercise))}\nNo bidding`
              : `${longDate(exerciseDate(d.exercise))}\nCat A ${money(d.A)}\nCat B ${money(d.B!)}\nCat E ${money(d.E!)}`,
        }),
      ),
    ].filter(Boolean) as Plot.Markish[],
  });

  // Headline: where the next car's category sits against its own record.
  const mine = history.premium(latest, highlight)!;
  const record = exercises.reduce<{ e: Exercise; v: number } | undefined>((a, e) => {
    const v = history.premium(e, highlight);
    return v !== undefined && (!a || v > a.v) ? { e, v } : a;
  }, undefined)!;
  const below = Math.round((1 - mine / record.v) * 100);
  const headline =
    record.v === mine
      ? `Cat ${highlight} premiums are at a record ${money(mine)}.`
      : `Cat ${highlight} premiums are ${money(mine)}, ${below === 0 ? "within 1%" : `${below}%`} below their record of ${money(record.v)} (${longDate(exerciseDate(record.e))}).`;

  return h(
    "div",
    {},
    h("p", { class: "kicker" }, `COE premiums, ${longDate(exerciseDate(latest))} exercise`),
    h("h3", { class: "takeaway" }, headline),
    tiles,
    h("figure", { class: "chart" }, chart),
    h(
      "ul",
      { class: "legend" },
      ...CATEGORIES.map((c) => h("li", {}, h("span", { class: `sw line s-${c.id}` }), `Cat ${c.id}`)),
      window ? h("li", {}, h("span", { class: "sw window" }), "Your window") : null,
    ),
    method(h("p", {}, "A car's COE category is fixed by its engine size and power, and it bids only in that category (or in Cat E). The premium goes straight into the price, so the same OMV can cost very different amounts in Cat A and Cat B. Data: LTA DataMall COE results.")),
  );
}
