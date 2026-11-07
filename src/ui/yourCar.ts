/** Section 1: "Do you own a car now?" — the form and the numbers it unlocks. */
import { compareDates, type RuleSet } from "../rules/index";
import { field, h, longDate, money, monthLabel, source } from "./dom";
import { latestPqp } from "./data";
import type { Errors, Profile, ValidCar } from "./profile";

export function yourCarForm(profile: Profile, errors: Errors, onChange: (p: Profile) => void, carSelect: HTMLElement, estimated: number): HTMLElement {
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => onChange({ ...profile, [key]: value });
  const input = (key: keyof Profile, type: string, extra: Record<string, string> = {}) =>
    h("input", {
      type,
      name: key,
      value: String(profile[key]),
      "aria-invalid": errors[key] ? "true" : undefined,
      onchange: (e: Event) => set(key, (e.target as HTMLInputElement).value as never),
      ...extra,
    });
  const select = (key: keyof Profile, options: [string, string][]) =>
    h(
      "select",
      { name: key, onchange: (e: Event) => set(key, (e.target as HTMLSelectElement).value as never) },
      ...options.map(([value, label]) => h("option", { value, selected: profile[key] === value }, label)),
    );

  const modeToggle = h(
    "div",
    { class: "toggle", role: "radiogroup", "aria-label": "Do you own a car now?" },
    ...([
      ["replace", "I own a car"],
      ["first", "This is my first car"],
    ] as const).map(([value, label]) =>
      h("button", { type: "button", role: "radio", "aria-checked": profile.mode === value ? "true" : "false", class: profile.mode === value ? "on" : "", onclick: () => set("mode", value) }, label),
    ),
  );

  if (profile.mode === "first") {
    return h(
      "div",
      { class: "form" },
      modeToggle,
      h("div", { class: "quick" }, field("When do you plan to buy?", input("targetMonth", "month"), errors.targetMonth), field("Car", carSelect)),
    );
  }

  const renewed = profile.renewal !== "none";
  const detailErrors = (["registrationDate", "arfPaid", "quotaPremiumPaid", "coeMonth"] as const).some((k) => errors[k]);
  return h(
    "div",
    { class: "form" },
    modeToggle,
    h(
      "div",
      { class: "quick" },
      field("When does your COE expire?", input("coeExpiryDate", "date"), errors.coeExpiryDate, "On your log card, or OneMotoring › Vehicle Hub."),
      field("COE category", select("category", [["A", "Cat A"], ["B", "Cat B"], ["E", "Cat E (open)"]])),
      profile.category === "E" ? field("Your car's own category", select("equivalentCategory", [["A", "Cat A"], ["B", "Cat B"]]), undefined, "Cat E cars renew at this category's PQP.") : null,
      field("Replacing it with", carSelect),
    ),
    h(
      "details",
      { class: "advanced", open: detailErrors },
      h("summary", {}, estimated ? `${estimated} figure${estimated === 1 ? " is" : "s are"} estimated. Add details from your log card for exact numbers` : "Details from your log card"),
      h(
        "div",
        { class: "grid" },
        field("Registration date", input("registrationDate", "date"), errors.registrationDate, "Blank: 10 years before expiry."),
        field("ARF paid", input("arfPaid", "text", { inputmode: "numeric", placeholder: "Blank: a typical car's" }), errors.arfPaid, "Net of any CEVS/VES/EEAI rebate."),
        field("COE already renewed?", select("renewal", [["none", "No, original COE"], ["10", "Yes, for 10 years"], ["5", "Yes, for 5 years"]])),
        field(
          renewed ? "PQP you paid to renew" : "QP you paid",
          input("quotaPremiumPaid", "text", { inputmode: "numeric", placeholder: "Blank: that month's premium" }),
          errors.quotaPremiumPaid,
        ),
        field("COE bidding month", input("coeMonth", "month"), errors.coeMonth, "Only if the COE was bought in a different month from registration. Picks your PARF schedule."),
        field("Exercise", select("coeBidding", [["", "Same as registration"], ["1", "1st exercise"], ["2", "2nd exercise"]])),
      ),
    ),
  );
}

/** The figures behind the answer: what LTA pays back, what renewing costs, and what was estimated. */
export function yourCarResults(valid: ValidCar, rules: RuleSet): HTMLElement {
  const { car } = valid;
  const today = rules.asOf;
  const now = rules.deregistrationValue(car, today);
  const atExpiry = rules.deregistrationValue(car, car.coeExpiryDate);
  const category = rules.renewalCategory(car);
  const pqp = latestPqp(category);
  const options = rules.renewalOptions(car, pqp.pqp);
  const monthsLeft = Math.max(0, Math.round(compareDates(car.coeExpiryDate, today) / (86_400_000 * 30.44)));

  return h(
    "div",
    { class: "results" },
    h("div", { class: "kicker" }, "Your window"),
    h("div", { class: "big" }, `Now → ${longDate(car.coeExpiryDate)}`),
    h("p", { class: "sub" }, `${monthsLeft} months until your COE expires (registered ${longDate(car.registrationDate)}).`),

    h("div", { class: "kicker" }, "Deregister today"),
    h("div", { class: "big" }, money(now.total)),
    h("p", { class: "sub" }, `PARF ${money(now.parf)} + COE rebate ${money(now.coeRebate)}`, car.renewal ? " (no PARF: the COE was renewed)." : "."),
    ...valid.estimates.map((e) => h("p", { class: "estimate" }, `Estimate: ${e.note}`)),

    h("div", { class: "kicker" }, "Renew past expiry"),
    options.length === 0
      ? h("p", { class: "warn" }, "A 5-year renewal can't be renewed again: this car must be deregistered at expiry.")
      : h(
          "ul",
          { class: "options" },
          ...options.map((o) =>
            h("li", {}, h("strong", {}, `${o.termYears} years: ${money(o.cost)}`), ` (${money(o.cost / o.termYears)} a year)`),
          ),
        ),
    options.length && atExpiry.parf > 0 ? h("p", { class: "sub" }, `Renewing also gives up ${money(atExpiry.parf)} of PARF you'd get by deregistering at expiry.`) : null,
    h("p", { class: "src-line" }, `Cat ${category} PQP for ${monthLabel(pqp.month)}: ${money(pqp.pqp)} (LTA, published). Rules as of ${longDate(today)}. `, source("https://onemotoring.lta.gov.sg/content/onemotoring/home/buying/rebates/parf-coe-rebate.html", "PARF & COE rebate rules")),
  );
}
