import "./style.css";
import { addMonthsToDate, rulesAt, compareDates } from "./rules/index";
import { backtest } from "./model/backtest";
import { radar } from "./model/radar";
import { h, longDate } from "./ui/dom";
import { data, history, latestExercise } from "./ui/data";
import { EMPTY_PROFILE, clearProfile, loadProfile, saveProfile, validateCar, type Profile } from "./ui/profile";
import { staleness } from "./ui/stale";
import { yourCarForm, yourCarResults } from "./ui/yourCar";
import { supplySection, type SupplyView } from "./ui/supply";
import { premiumsSection } from "./ui/premiums";
import { carSelect, defaultNextCar, nextCarFigures, nextCarSection, presetById, type NextCarState } from "./ui/nextCar";
import { plansSection } from "./ui/plans";
import { buyerAnswer, ownerAnswer } from "./ui/hero";
import { decodeScenario, encodeScenario } from "./ui/share";

/** Today in Singapore, as YYYY-MM-DD. Tests pin it with ?today=YYYY-MM-DD. */
function todayInSingapore(): string {
  const pinned = new URLSearchParams(location.search).get("today");
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
}

const today = todayInSingapore();
const rules = rulesAt(today);
const radarInput = {
  registrations: data.registrations.rows,
  deregistrations: data.deregistrations.rows,
  revalidations: data.revalidations.rows,
  coe: data.coe.rows,
  untilMonth: "2030-12",
};
const supply: Record<SupplyView, ReturnType<typeof radar>> = {
  all: radar(radarInput),
  A: radar({ ...radarInput, category: "A" }),
  B: radar({ ...radarInput, category: "B" }),
};

const pqpAt = (month: string, category: "A" | "B") => data.pqp.rows.find((r) => r.month === month && r.category === category)?.pqp;
/** Shown until the visitor types their own expiry, so the page answers something on first load. */
const EXAMPLE: Profile = { ...EMPTY_PROFILE, coeExpiryDate: addMonthsToDate(today, 23) };

const loaded = loadProfile();
const shared = decodeScenario(location.hash);
// supplyView: undefined follows the next car's category until the visitor picks one.
const state: {
  profile: Profile;
  nextCar: NextCarState;
  remembered: boolean;
  supplyView?: SupplyView;
  /** The month picked on the "switch in" slider. */
  switchAt?: string;
  /** Opened from a share link; the saved car is untouched until the visitor edits. */
  shared: boolean;
  shareNote?: string;
} = {
  profile: shared?.profile ?? loaded.profile,
  nextCar: shared?.nextCar ?? defaultNextCar(),
  remembered: loaded.remembered,
  switchAt: shared?.switchAt,
  shared: shared !== undefined,
};

const root = document.getElementById("app")!;

function render(): void {
  const width = Math.min(920, root.clientWidth || 920);
  const p = state.profile;
  const example = p.mode === "replace" && !hasInput(p);
  const validation = p.mode === "replace" ? validateCar(example ? { ...EXAMPLE, category: p.category, equivalentCategory: p.equivalentCategory } : p, today, history, pqpAt) : undefined;
  const valid = validation?.ok ? validation.value : undefined;
  const errors = validation && !validation.ok && !example ? validation.errors : {};

  const targetDate = p.mode === "first" && /^\d{4}-\d{2}$/.test(p.targetMonth) ? `${p.targetMonth}-15` : undefined;
  const deadline = valid ? valid.car.coeExpiryDate : targetDate;
  const purchaseDate = deadline && compareDates(deadline, today) > 0 ? deadline : today;
  const window = deadline && compareDates(deadline, today) > 0 ? { from: today, to: deadline } : undefined;

  const next = nextCarFigures(state.nextCar, rules, purchaseDate);
  const preset = presetById(state.nextCar.presetId);
  const nextCategory = preset.category as "A" | "B";
  const strips =
    p.mode === "first" || valid
      ? backtest({
          coe: data.coe.rows,
          rules,
          category: preset.category as "A" | "B",
          newCar: { omv: next.omv, band: preset.band as "A" | "B" | "C1", electric: preset.electric },
          oldCar: valid
            ? { arfPaid: valid.car.arfPaid, quotaPremiumPaid: valid.car.quotaPremiumPaid, coeExercise: valid.car.coeExercise, renewal: valid.car.renewal }
            : undefined,
        })
      : [];

  const heroCtx = { rules, today, nextCar: state.nextCar, radar: supply[nextCategory], width: width - 48 };
  const answer =
    p.mode === "first"
      ? buyerAnswer(/^\d{4}-\d{2}$/.test(p.targetMonth) ? p.targetMonth : undefined, heroCtx, (targetMonth) => update({ profile: { ...p, targetMonth } }))
      : valid
        ? ownerAnswer(valid, example, heroCtx, state.switchAt, (switchAt) => (state.switchAt = switchAt))
        : h("div", { class: "answer-wrap" }, h("p", { class: "verdict-line" }, "Fix the highlighted field to see your answer."));

  const stale = staleness(latestExercise(), today);
  const children: (Node | null)[] = [
    h(
      "section",
      { class: "hero", "aria-labelledby": "s1" },
      h("p", { class: "eyebrow" }, "ev-coe · free and independent · information, not financial advice"),
      h("h1", { id: "s1" }, p.mode === "first" ? "When should you buy your car?" : "When should you replace your car?"),
      stale.stale
        ? h("div", { class: "banner", role: "status" }, `COE data last updated for the exercise of ${longDate(stale.asOf)}, ${stale.ageDays} days ago. Newer results may be missing.`)
        : null,
      state.shared
        ? h("div", { class: "banner", role: "status" }, "You opened a shared scenario. Your own saved car is untouched unless you edit this one. ", h("button", { type: "button", class: "link", onclick: () => backToMyCar() }, "Back to my car"))
        : null,
      yourCarForm(p, errors, (profile) => update({ profile }), carSelect(state.nextCar, (nextCar) => update({ nextCar }), "heroPreset"), valid && !example ? valid.estimates.length : 0),
      example ? h("p", { class: "example-note" }, "Showing an example car whose COE expires in 23 months. Enter your expiry date to see yours.") : null,
      answer,
      valid ? h("details", { class: "method" }, h("summary", {}, "Behind these numbers"), yourCarResults(valid, rules)) : null,
      h(
        "div",
        { class: "hero-foot" },
        h("button", { type: "button", class: "share", onclick: () => share() }, "Share this result"),
        h("span", { class: "hint" }, state.shareNote ?? "The link carries your figures after the #, which never reaches a server. Anyone you send it to can see them."),
      ),
      h(
        "p",
        { class: "storage" },
        state.remembered ? "Your car is saved in this browser only, never uploaded. " : "Your browser is blocking storage, so your car won't be remembered after you leave. ",
        state.remembered ? h("button", { type: "button", class: "link", onclick: () => clearCar() }, "Clear my car") : null,
      ),
    ),
    h(
      "section",
      { class: "card", "aria-labelledby": "s2" },
      h("h2", { id: "s2" }, "What could move prices: premiums and supply"),
      premiumsSection(nextCategory, window, width - 48),
      supplySection(supply, state.supplyView ?? nextCategory, (supplyView) => update({ supplyView }), window, width - 48),
    ),
    h("section", { class: "card", "aria-labelledby": "s3" }, h("h2", { id: "s3" }, "Your next car"), nextCarSection(state.nextCar, rules, purchaseDate, (nextCar) => update({ nextCar }))),
    h(
      "section",
      { class: "card", "aria-labelledby": "s4" },
      h("h2", { id: "s4" }, p.mode === "first" ? "What buying in your month has cost" : "What each plan would have cost someone with your deadline"),
      strips.length
        ? plansSection(strips, width - 48, `${preset.label}, OMV $${next.omv.toLocaleString("en-SG")}`, { category: nextCategory, today, deadline })
        : h("p", { class: "results empty" }, "Fill in your car above to replay the plans."),
    ),
    h(
      "footer",
      {},
      h("p", {}, `COE data: LTA DataMall, latest exercise ${longDate(stale.asOf)}. Rules: LTA and MAS, as of ${longDate(today)}. Every figure is an estimate from published rules and data; check with LTA, your dealer and your bank before deciding.`),
      h("p", {}, "This tool gives information, not financial advice."),
    ),
  ];
  // Re-rendering replaces every element; keep keyboard focus on the control the visitor was using,
  // and keep open whatever "details" panels they opened.
  const focused = document.activeElement?.getAttribute("name");
  const opened = new Set([...root.querySelectorAll("details")].filter((d) => d.open).map(detailsKey));
  root.replaceChildren(...children.filter((c): c is Node => c !== null));
  for (const d of root.querySelectorAll("details")) if (opened.has(detailsKey(d))) d.open = true;
  if (focused) root.querySelector<HTMLElement>(`[name="${focused}"]`)?.focus();
}

/** A details panel's place on the page: its section and its position within it. */
function detailsKey(d: HTMLDetailsElement): string {
  const section = d.closest("section");
  return `${section?.getAttribute("aria-labelledby")}:${section ? [...section.querySelectorAll("details")].indexOf(d) : -1}`;
}

function hasInput(p: Profile): boolean {
  return Boolean(p.registrationDate || p.coeExpiryDate || p.arfPaid || p.quotaPremiumPaid);
}

function update(change: Partial<typeof state>): void {
  Object.assign(state, change, { shareNote: undefined });
  if (change.profile) {
    state.remembered = saveProfile(state.profile);
    if (state.shared) leaveSharedLink();
  }
  render();
}

function leaveSharedLink(): void {
  state.shared = false;
  window.history.replaceState(null, "", location.pathname + location.search);
}

function backToMyCar(): void {
  leaveSharedLink();
  Object.assign(state, { profile: loadProfile().profile, nextCar: defaultNextCar(), switchAt: undefined });
  render();
}

async function share(): Promise<void> {
  // Never the query string (it would reach server logs), and never the ?today= test pin.
  const url = location.origin + location.pathname + encodeScenario({ profile: state.profile, nextCar: state.nextCar, switchAt: state.switchAt });
  try {
    if (navigator.share) {
      await navigator.share({ title: "When should you replace your car?", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    state.shareNote = "Link copied. It carries your figures; anyone you send it to can see them.";
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    state.shareNote = `Copy this link: ${url}`;
  }
  render();
}

function clearCar(): void {
  clearProfile();
  state.profile = loadProfile().profile;
  render();
}

render();
// Mobile browsers fire resize as the address bar slides; only a width change needs a redraw.
let lastWidth = root.clientWidth;
addEventListener("resize", () => {
  if (root.clientWidth === lastWidth) return;
  lastWidth = root.clientWidth;
  render();
});
