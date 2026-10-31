import type { Exercise } from "../rules/index";
import type { CoeResult } from "./data";

export type Category = "A" | "B" | "C" | "D" | "E";

/** Premium history by exercise, with lookups that tolerate months without bidding (Apr-Jun 2020). */
export class PremiumHistory {
  private readonly byKey = new Map<string, number>();
  private readonly held = new Set<string>();
  private readonly months: string[];

  constructor(rows: CoeResult[]) {
    for (const r of rows) {
      this.byKey.set(key(r.month, r.bidding, r.category), r.premium);
      this.held.add(`${r.month}/${r.bidding}`);
    }
    this.months = [...new Set(rows.map((r) => r.month))].sort();
  }

  get firstMonth(): string {
    return this.months[0]!;
  }

  get latestMonth(): string {
    return this.months.at(-1)!;
  }

  premium(exercise: Exercise, category: Category): number | undefined {
    return this.byKey.get(key(exercise.month, exercise.bidding, category));
  }

  /**
   * PQP for renewing in `month`: the mean of all premiums in the last 3 months with bidding before
   * `month`, rounded up. Matches every LTA-published Cat A/B PQP since 2010.
   */
  pqp(month: string, category: Category): number | undefined {
    const prior = this.months.filter((m) => m < month).slice(-3);
    if (prior.length < 3) return undefined;
    const values = prior.flatMap((m) => [1, 2].map((b) => this.byKey.get(key(m, b, category)))).filter((v): v is number => v !== undefined);
    if (values.length === 0) return undefined;
    return Math.ceil(values.reduce((a, b) => a + b, 0) / values.length);
  }

  /** All exercises in order. */
  exercises(): Exercise[] {
    return this.months.flatMap((month) => ([1, 2] as const).filter((b) => this.held.has(`${month}/${b}`)).map((bidding) => ({ month, bidding })));
  }
}

function key(month: string, bidding: number, category: string): string {
  return `${month}/${bidding}/${category}`;
}

export function shiftExercise(e: Exercise, years: number): Exercise {
  const [y, m] = e.month.split("-") as [string, string];
  return { month: `${Number(y) + years}-${m}`, bidding: e.bidding };
}

/** Calendar date used for an exercise: results are out around the 7th (1st exercise) and 21st (2nd). */
export function exerciseDate(e: Exercise): string {
  return `${e.month}-${e.bidding === 1 ? "07" : "21"}`;
}
