/**
 * Share links carry the scenario in the URL fragment (#s=...), never the query string: the fragment
 * stays in the browser, so it never reaches GitHub Pages' logs (eng review D22, TODOS.md).
 */
import { EMPTY_PROFILE, type Profile } from "./profile";
import { defaultNextCar, presetById, type NextCarState } from "./nextCar";

export interface Scenario {
  profile: Profile;
  nextCar: NextCarState;
  switchAt?: string;
}

const PREFIX = "#s=";
const CHOICES = {
  mode: ["replace", "first"],
  category: ["A", "B", "E"],
  equivalentCategory: ["A", "B"],
  qpMode: ["actual", "indicative"],
  renewal: ["none", "5", "10"],
  coeBidding: ["", "1", "2"],
} as const;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Only the fields that differ from a fresh visit, so links stay short. */
export function encodeScenario(s: Scenario): string {
  const fresh = defaultNextCar();
  const p = Object.fromEntries(Object.entries(s.profile).filter(([k, v]) => EMPTY_PROFILE[k as keyof Profile] !== v));
  const n = Object.fromEntries(Object.entries(s.nextCar).filter(([k, v]) => fresh[k as keyof NextCarState] !== v));
  return PREFIX + toBase64Url(JSON.stringify({ p, n, ...(s.switchAt ? { w: s.switchAt } : {}) }));
}

/** Reads a scenario from a fragment, keeping only known fields of the right type; undefined if it isn't one. */
export function decodeScenario(hash: string): Scenario | undefined {
  if (!hash.startsWith(PREFIX)) return undefined;
  try {
    const raw = JSON.parse(fromBase64Url(hash.slice(PREFIX.length))) as { p?: Record<string, unknown>; n?: Record<string, unknown>; w?: unknown };
    const profile = pick(EMPTY_PROFILE, raw.p);
    for (const [k, allowed] of Object.entries(CHOICES) as [keyof typeof CHOICES, readonly string[]][]) if (!allowed.includes(profile[k])) (profile[k] as string) = EMPTY_PROFILE[k];
    const nextCar = pick(defaultNextCar(), raw.n);
    nextCar.presetId = presetById(nextCar.presetId).id;
    if (![5, 8, 10].includes(nextCar.holdingYears)) nextCar.holdingYears = 10;
    const fresh = defaultNextCar();
    if (!["new", "used"].includes(nextCar.kind)) nextCar.kind = fresh.kind;
    if (!Number.isFinite(nextCar.premiumTrend) || Math.abs(nextCar.premiumTrend) > 0.1) nextCar.premiumTrend = fresh.premiumTrend;
    if (!Number.isInteger(nextCar.repairRise) || nextCar.repairRise < 0 || nextCar.repairRise > 1000) nextCar.repairRise = fresh.repairRise;
    if (!Number.isFinite(nextCar.interest) || nextCar.interest < 0 || nextCar.interest > 0.08) nextCar.interest = fresh.interest;
    if (!Number.isFinite(nextCar.inflation) || nextCar.inflation < 0 || nextCar.inflation > 0.05) nextCar.inflation = fresh.inflation;
    if (!Number.isInteger(nextCar.usedYearsLeft) || nextCar.usedYearsLeft < 1 || nextCar.usedYearsLeft > 9) nextCar.usedYearsLeft = fresh.usedYearsLeft;
    const switchAt = typeof raw.w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.w) ? raw.w : undefined;
    return { profile, nextCar, switchAt };
  } catch {
    return undefined;
  }
}

function pick<T extends object>(base: T, raw: Record<string, unknown> | undefined): T {
  const out = { ...base };
  for (const [k, v] of Object.entries(raw ?? {})) if (k in base && typeof v === typeof base[k as keyof T]) (out as Record<string, unknown>)[k] = v;
  return out;
}
