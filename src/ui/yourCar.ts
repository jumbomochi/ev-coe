/** Section 1: "Do you own a car now?" — the form and the numbers it unlocks. */
import { compareDates, type RuleSet } from "../rules/index";
import { field, h, longDate, money, monthLabel, source } from "./dom";
import { latestPqp } from "./data";
import type { Errors, Profile, ValidCar } from "./profile";

export function yourCarForm(profile: Profile, errors: Errors, onChange: (p: Profile) => void): HTMLElement {
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
      ["replace", "Yes, I'm replacing it"],
      ["first", "No, this is my first car"],
    ] as const).map(([value, label]) =>
      h("button", { type: "button", role: "radio", "aria-checked": profile.mode === value ? "true" : "false", class: profile.mode === value ? "on" : "", onclick: () => set("mode", value) }, label),
    ),
  );

  if (profile.mode === "first") {
    return h(
      "div",
      { class: "form" },
      modeToggle,
      field("When do you plan to buy?", input("targetMonth", "month"), errors.targetMonth, "Used to mark your window on the supply chart."),
    );
  }

  const renewed = profile.renewal !== "none";
  return h(
    "div",
    { class: "form" },
    modeToggle,
    h("p", { class: "hint" }, "From your vehicle log card or OneMotoring › Vehicle Hub. Saved only in this browser."),
    h(
      "div",
      { class: "grid" },
      field("Registration date", input("registrationDate", "date"), errors.registrationDate),
      field("COE expiry date", input("coeExpiryDate", "date"), errors.coeExpiryDate),
      field("COE category", select("category", [["A", "Cat A"], ["B", "Cat B"], ["E", "Cat E (open)"]])),
      profile.category === "E" ? field("Your car's own category", select("equivalentCategory", [["A", "Cat A"], ["B", "Cat B"]]), undefined, "Cat E cars renew at this category's PQP.") : null,
      field("ARF paid", input("arfPaid", "text", { inputmode: "numeric", placeholder: "e.g. 20,000" }), errors.arfPaid, "Net of any CEVS/VES/EEAI rebate."),
      field("COE already renewed?", select("renewal", [["none", "No, original COE"], ["10", "Yes, for 10 years"], ["5", "Yes, for 5 years"]])),
      renewed
        ? field("PQP you paid to renew", input("quotaPremiumPaid", "text", { inputmode: "numeric" }), errors.quotaPremiumPaid)
        : field(
            "QP you paid",
            h(
              "div",
              { class: "inline" },
              select("qpMode", [["actual", "I'll enter it"], ["indicative", "Estimate it for me"]]),
              profile.qpMode === "actual" ? input("quotaPremiumPaid", "text", { inputmode: "numeric", placeholder: "e.g. 26,000" }) : null,
            ),
            errors.quotaPremiumPaid,
          ),
    ),
    h(
      "details",
      { class: "advanced" },
      h("summary", {}, "COE bought in a different month from registration?"),
      h(
        "div",
        { class: "grid" },
        field("COE bidding month", input("coeMonth", "month"), errors.coeMonth, "Picks your PARF schedule (it changed in Feb 2023 and Feb 2026)."),
        field("Exercise", select("coeBidding", [["", "Same as registration"], ["1", "1st exercise"], ["2", "2nd exercise"]])),
      ),
    ),
  );
}

export function yourCarResults(valid: ValidCar | undefined, rules: RuleSet): HTMLElement {
  if (!valid) return h("div", { class: "results empty" }, h("p", {}, "Fill in your car to see your window, what you'd get back today, and what renewing costs."));
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
    h("p", { class: "sub" }, `${monthsLeft} months until your COE expires.`),

    h("div", { class: "kicker" }, "Deregister today"),
    h("div", { class: "big" }, money(now.total)),
    h("p", { class: "sub" }, `PARF ${money(now.parf)} + COE rebate ${money(now.coeRebate)}`, car.renewal ? " (no PARF: the COE was renewed)." : "."),
    valid.indicativeQp !== undefined ? h("p", { class: "estimate" }, `Estimate: QP taken as ${money(valid.indicativeQp)}, the average premium in your COE month. Yours may differ if it was bid earlier.`) : null,

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
