import "./style.css";
import { rulesAt, compareDates } from "./rules/index";
import { backtest } from "./model/backtest";
import { radar } from "./model/radar";
import { h, longDate } from "./ui/dom";
import { data, history, latestExercise } from "./ui/data";
import { clearProfile, loadProfile, saveProfile, validateCar, type Profile } from "./ui/profile";
import { staleness } from "./ui/stale";
import { yourCarForm, yourCarResults } from "./ui/yourCar";
import { supplySection } from "./ui/supply";
import { defaultNextCar, nextCarFigures, nextCarSection, presetById, type NextCarState } from "./ui/nextCar";
import { plansSection } from "./ui/plans";

/** Today in Singapore, as YYYY-MM-DD. Tests pin it with ?today=YYYY-MM-DD. */
function todayInSingapore(): string {
  const pinned = new URLSearchParams(location.search).get("today");
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
}

const today = todayInSingapore();
const rules = rulesAt(today);
const supply = radar({
  registrations: data.registrations.rows,
  deregistrations: data.deregistrations.rows,
  revalidations: data.revalidations.rows,
  coe: data.coe.rows,
  untilMonth: "2030-12",
});

const loaded = loadProfile();
const state: { profile: Profile; nextCar: NextCarState; remembered: boolean } = {
  profile: loaded.profile,
  nextCar: defaultNextCar(),
  remembered: loaded.remembered,
};

const root = document.getElementById("app")!;

function render(): void {
  const width = Math.min(920, root.clientWidth || 920);
  const p = state.profile;
  const validation = p.mode === "replace" ? validateCar(p, today, history) : undefined;
  const valid = validation?.ok ? validation.value : undefined;
  const errors = validation && !validation.ok && hasInput(p) ? validation.errors : {};

  const targetDate = p.mode === "first" && /^\d{4}-\d{2}$/.test(p.targetMonth) ? `${p.targetMonth}-15` : undefined;
  const deadline = valid ? valid.car.coeExpiryDate : targetDate;
  const purchaseDate = deadline && compareDates(deadline, today) > 0 ? deadline : today;
  const window = deadline && compareDates(deadline, today) > 0 ? { from: today, to: deadline } : undefined;

  const next = nextCarFigures(state.nextCar, rules, purchaseDate);
  const preset = presetById(state.nextCar.presetId);
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

  const stale = staleness(latestExercise(), today);
  const children: (Node | null)[] = [
    h("header", {}, h("p", { class: "eyebrow" }, "ev-coe · free and independent · information, not financial advice"), h("h1", {}, "When should you replace your car?")),
    stale.stale
      ? h("div", { class: "banner", role: "status" }, `COE data last updated for the exercise of ${longDate(stale.asOf)}, ${stale.ageDays} days ago. Newer results may be missing.`)
      : null,
    h(
      "section",
      { class: "card", "aria-labelledby": "s1" },
      h("h2", { id: "s1" }, "Do you own a car now?"),
      h(
        "div",
        { class: "two-col" },
        yourCarForm(p, errors, (profile) => update({ profile })),
        p.mode === "replace" ? yourCarResults(valid, rules) : h("div", { class: "results empty" }, h("p", {}, "We'll mark your buying month on the supply chart and show what buying then has cost historically.")),
      ),
      h(
        "p",
        { class: "storage" },
        state.remembered ? "Your car is saved in this browser only, never uploaded. " : "Your browser is blocking storage, so your car won't be remembered after you leave. ",
        state.remembered ? h("button", { type: "button", class: "link", onclick: () => clearCar() }, "Clear my car") : null,
      ),
    ),
    h("section", { class: "card", "aria-labelledby": "s2" }, h("h2", { id: "s2" }, "COE supply in your window"), supplySection(supply, window, width - 48)),
    h("section", { class: "card", "aria-labelledby": "s3" }, h("h2", { id: "s3" }, "Your next car"), nextCarSection(state.nextCar, rules, purchaseDate, (nextCar) => update({ nextCar }))),
    h(
      "section",
      { class: "card", "aria-labelledby": "s4" },
      h("h2", { id: "s4" }, p.mode === "first" ? "What buying in your month has cost" : "What each plan would have cost someone with your deadline"),
      strips.length
        ? plansSection(strips, width - 48, `${preset.label}, OMV $${next.omv.toLocaleString("en-SG")}`)
        : h("p", { class: "results empty" }, "Fill in your car above to replay the plans."),
    ),
    h(
      "footer",
      {},
      h("p", {}, `COE data: LTA DataMall, latest exercise ${longDate(stale.asOf)}. Rules: LTA and MAS, as of ${longDate(today)}. Every figure is an estimate from published rules and data; check with LTA, your dealer and your bank before deciding.`),
      h("p", {}, "This tool gives information, not financial advice."),
    ),
  ];
  root.replaceChildren(...children.filter((c): c is Node => c !== null));
}

function hasInput(p: Profile): boolean {
  return Boolean(p.registrationDate || p.coeExpiryDate || p.arfPaid || p.quotaPremiumPaid);
}

function update(change: Partial<typeof state>): void {
  Object.assign(state, change);
  if (change.profile) state.remembered = saveProfile(state.profile);
  render();
}

function clearCar(): void {
  clearProfile();
  state.profile = loadProfile().profile;
  render();
}

render();
addEventListener("resize", () => render());
