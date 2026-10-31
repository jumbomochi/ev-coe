import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.ts$/.test(name) ? [path] : [];
  });
}

// Eng review D14: code outside src/rules may only import its index, so every
// calculation goes through rulesAt(date) and no caller picks schedules itself.
describe("src/rules boundary", () => {
  it("is only imported through its index", () => {
    const offenders: string[] = [];
    for (const dir of ["src", "scripts", "e2e"]) {
      let files: string[] = [];
      try {
        files = sourceFiles(join(root, dir));
      } catch {
        continue;
      }
      for (const file of files) {
        if (relative(root, file).startsWith(join("src", "rules"))) continue;
        for (const m of readFileSync(file, "utf8").matchAll(/from\s+["']([^"']*rules\/[^"']+)["']/g)) {
          if (!/rules\/index(\.ts)?$/.test(m[1]!)) offenders.push(`${relative(root, file)} → ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
