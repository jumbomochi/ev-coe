type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

/** Small element builder: h("p", { class: "note" }, "text", child). `on*` attrs become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(name, "");
    else el.setAttribute(name, String(value));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const whole = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 });

export function money(n: number): string {
  const rounded = Math.round(n);
  return (rounded < 0 ? "−$" : "$") + whole.format(Math.abs(rounded));
}

export function signedMoney(n: number): string {
  if (Math.round(n) === 0) return "$0";
  return (n > 0 ? "+" : "") + money(n);
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-SG", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function source(href: string, text = "source"): HTMLAnchorElement {
  return h("a", { href, target: "_blank", rel: "noopener", class: "src" }, text);
}

export function field(label: string, input: HTMLElement, error?: string, hint?: string): HTMLElement {
  return h(
    "label",
    { class: error ? "field invalid" : "field" },
    h("span", { class: "label" }, label),
    input,
    hint ? h("span", { class: "hint" }, hint) : null,
    error ? h("span", { class: "error", role: "alert" }, error) : null,
  );
}

/** Method notes, folded away under the chart they explain. */
export function method(...children: Child[]): HTMLDetailsElement {
  return h("details", { class: "method" }, h("summary", {}, "How we worked this out"), h("div", {}, ...children));
}
