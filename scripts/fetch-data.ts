/**
 * Downloads LTA DataMall's static COE and vehicle files, validates every one, and only then
 * writes data/<id>.json. Any failure exits non-zero and writes nothing, so the workflow
 * commits and deploys nothing (eng review D11, D12). Output has no timestamps: re-running
 * on unchanged upstream data produces identical files, so git sees no change.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { SOURCES, validate, type Dataset } from "./datamall";

const OUT_DIR = join(import.meta.dirname, "..", "data");
const TIMEOUT_MS = 60_000;

async function download(url: string): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }
}

function csvFromZip(zip: Uint8Array, name: string): string {
  const files = unzipSync(zip);
  const entry = Object.keys(files).find((path) => path.split("/").pop() === name);
  if (!entry) throw new Error(`${name} not found in zip (has: ${Object.keys(files).join(", ")})`);
  return strFromU8(files[entry]!);
}

function readPrevious(id: string): Dataset<unknown> | null {
  const path = join(OUT_DIR, `${id}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Dataset<unknown>) : null;
}

async function main(): Promise<void> {
  const zips = new Map<string, Promise<Uint8Array>>();
  const results: { id: string; dataset: Dataset<unknown> }[] = [];
  const errors: string[] = [];

  for (const source of SOURCES) {
    try {
      if (!zips.has(source.zipUrl)) zips.set(source.zipUrl, download(source.zipUrl));
      const csv = csvFromZip(await zips.get(source.zipUrl)!, source.csvName);
      const outcome = validate(source as never, csv, readPrevious(source.id) as never);
      if (outcome.ok) results.push({ id: source.id, dataset: outcome.dataset as Dataset<unknown> });
      else errors.push(...outcome.errors);
    } catch (e) {
      errors.push(`${source.id}: ${(e as Error).message}`);
    }
  }

  if (errors.length) {
    console.error(`fetch-data: ${errors.length} problem(s); nothing written.\n` + errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { id, dataset } of results) {
    writeFileSync(join(OUT_DIR, `${id}.json`), JSON.stringify(dataset) + "\n");
    console.log(`fetch-data: ${id}: ${dataset.rows.length} rows, latest ${dataset.latestMonth}`);
  }
}

await main();
