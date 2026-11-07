import { expect, test, type Page } from "@playwright/test";

// Frozen clock (?today=) and frozen data (e2e/fixtures/data, latest exercise 21 Oct 2026).
// The car is synthetic; expected figures are worked out by hand from LTA's rules:
//   PARF: age 8y 16d → "above 8, not more than 9 years" → 55% × $20,000 = $11,000
//   COE rebate: 1 Nov 2026 – 14 Oct 2028 = 23 months + 14 days = 23.5 → $26,000 × 23.5 / 120 = $5,091
//   Renewal: LTA's published Cat A PQP for Nov 2026 = $129,883; 5 years = ⌈129,883 / 2⌉ = $64,942
//   PARF given up by renewing: age at expiry 9y 364d → 50% × $20,000 = $10,000
const TODAY = "2026-10-31";

async function fill(page: Page, name: string, value: string) {
  const input = page.locator(`input[name=${name}]`);
  await input.fill(value);
  await input.press("Tab");
}

async function logCard(page: Page) {
  const details = page.locator("section[aria-labelledby=s1] details.advanced");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/?today=${TODAY}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("first visit answers for an example car, before any input", async ({ page }) => {
  const hero = page.locator("section[aria-labelledby=s1]");
  await expect(hero.locator(".countdown")).toContainText("Example car");
  await expect(hero.locator(".huge")).toHaveText("23 months");
  await expect(hero.locator(".bars li")).toHaveCount(4);
  await expect(hero.locator(".bars li.best")).toHaveCount(1);
  await expect(hero.locator(".verdict-line")).toContainText("If premiums stay at today's level");
});

test("the premium setting reruns the plans and says what it implies", async ({ page }) => {
  const hero = page.locator("section[aria-labelledby=s1]");
  await expect(hero.locator(".trend")).toContainText("stay at today's level");
  await hero.locator("input[name=premiumTrend]").fill("5");
  await expect(hero.locator(".verdict-line")).toContainText("If premiums rise 5% a year");
  await expect(hero.locator(".trend")).toContainText("rise 5% a year");
  await expect(hero.locator(".trend > p.hint")).toContainText("Over the past 10 years");
  await hero.locator("input[name=premiumTrend]").fill("-5");
  await expect(hero.locator(".verdict-line")).toContainText("If premiums fall 5% a year");
  await expect(hero.locator(".break-even")).toContainText("Renewing wins only while");
});

test("a used next car gets a suggested price range and flows into the plans", async ({ page }) => {
  const hero = page.locator("section[aria-labelledby=s1]");
  const s3 = page.locator("section[aria-labelledby=s3]");
  await s3.getByRole("radio", { name: "Used", exact: true }).click();
  await expect(s3.locator(".results")).toContainText("Suggested price today");
  await expect(s3.locator(".results .big").first()).toHaveText(/^\$[\d,]+ – \$[\d,]+$/);
  await expect(hero.locator(".bars")).toContainText("used Honda HR-V 1.5 DX with 5 years of COE");
  await expect(hero.locator("select[name=heroKind]")).toHaveValue("used");

  await s3.locator("select[name=usedYearsLeft]").selectOption("2");
  await expect(s3.locator(".form")).toContainText("about 8 years old");
  await fill(page, "usedPrice", "200,000");
  await expect(s3.locator(".results")).toContainText("above the range");
  await expect(s3.locator(".results")).toContainText("Asking price $200,000");
});

test("only the expiry date is needed; the rest is estimated and says so", async ({ page }) => {
  await fill(page, "coeExpiryDate", "2028-10-14");
  const hero = page.locator("section[aria-labelledby=s1]");
  await expect(hero.locator(".countdown")).not.toContainText("Example car");
  await expect(hero.locator("details.advanced summary")).toHaveText(/^3 figures are estimated/);
  await expect(hero.locator("details.method .results")).toContainText("Estimate: Registration taken as 2018-10-15");
});

test("the switch slider redraws the month's figures", async ({ page }) => {
  await fill(page, "coeExpiryDate", "2028-10-14");
  const explore = page.locator(".explore");
  await expect(explore.locator("h3")).toHaveText("What if you switch in Oct 2028?");
  // At expiry the COE rebate is gone; LTA pays back the PARF alone (50% of the estimated $20,000 ARF).
  await expect(explore.locator(".readout").first()).toContainText("$10,000");
  await explore.locator("input[name=switchAt]").fill("0");
  await expect(explore.locator("h3")).toHaveText("What if you switch in Oct 2026?");
  await expect(explore.locator(".readout").first()).toContainText("PARF + COE rebate, today");
});

test("a share link carries the scenario in the fragment and reopens it", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void ((window as unknown as { copied: string }).copied = t) } });
  });
  await page.reload();
  await fill(page, "coeExpiryDate", "2028-10-14");
  await page.getByRole("button", { name: "Share this result" }).click();
  await expect(page.locator(".hero-foot")).toContainText("Link copied");
  const url = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(url).toMatch(/#s=[A-Za-z0-9_-]+$/);
  expect(url).not.toContain("?");

  await page.evaluate(() => localStorage.clear());
  // Only the fragment differs from the current URL, so goto alone wouldn't reload the page.
  await page.goto(url.replace(/^[^#]*/, `/?today=${TODAY}`));
  await page.reload();
  await expect(page.getByRole("status")).toContainText("shared scenario");
  await expect(page.locator("input[name=coeExpiryDate]")).toHaveValue("2028-10-14");
  await page.getByRole("button", { name: "Back to my car" }).click();
  await expect(page.locator("input[name=coeExpiryDate]")).toHaveValue("");
});

test("replacing owner: window, deregister value, renewal and plan strips", async ({ page }) => {
  await fill(page, "coeExpiryDate", "2028-10-14");
  await logCard(page);
  await fill(page, "registrationDate", "2018-10-15");
  await fill(page, "arfPaid", "20,000");
  await fill(page, "quotaPremiumPaid", "26,000");

  const results = page.locator("section[aria-labelledby=s1] details.method .results");
  await expect(results).toContainText("Now → 14 Oct 2028");
  await expect(results).toContainText("$16,091");
  await expect(results).toContainText("PARF $11,000 + COE rebate $5,091");
  await expect(results).toContainText("10 years: $129,883");
  await expect(results).toContainText("5 years: $64,942");
  await expect(results).toContainText("gives up $10,000 of PARF");

  await expect(page.locator("section[aria-labelledby=s2] svg").first()).toBeVisible();

  const plans = page.locator("section[aria-labelledby=s4]");
  await expect(plans.locator(".tile h3")).toHaveText(["Buy when your COE expires", "Renew 5 years, then buy", "Buy a year early"]);
  await expect(plans).toContainText("N = 242");
});

test("first-car buyer: target month and the single history strip", async ({ page }) => {
  await page.getByRole("radio", { name: "This is my first car" }).click();
  await fill(page, "targetMonth", "2027-06");
  const plans = page.locator("section[aria-labelledby=s4]");
  await expect(plans.locator("h2")).toHaveText("What buying in your month has cost");
  await expect(plans.locator(".tile h3")).toHaveText(["Buy in your target month"]);
  await expect(page.locator(".explore h3")).toHaveText("What if you buy in Jun 2027?");
  await expect(plans).toContainText("N = 398");
});

test("impossible input shows a message, not figures", async ({ page }) => {
  await logCard(page);
  await fill(page, "registrationDate", "2018-10-15");
  await fill(page, "coeExpiryDate", "2017-01-01");
  await expect(page.locator("label:has(input[name=coeExpiryDate]) .error")).toHaveText("COE expiry must be after registration");
  await expect(page.locator("section[aria-labelledby=s1] .verdict-line")).toHaveText("Fix the highlighted field to see your answer.");
  await expect(page.locator("section[aria-labelledby=s1] .bars")).toHaveCount(0);
});

test("Clear my car forgets the profile after a reload", async ({ page }) => {
  await logCard(page);
  await fill(page, "arfPaid", "20000");
  await page.reload();
  await expect(page.locator("input[name=arfPaid]")).toHaveValue("20000");
  await page.getByRole("button", { name: "Clear my car" }).click();
  await page.reload();
  await expect(page.locator("input[name=arfPaid]")).toHaveValue("");
});

test("COE categories: premiums by category, and supply follows the next car's category", async ({ page }) => {
  const s2 = page.locator("section[aria-labelledby=s2]");
  await expect(s2.locator(".tile")).toHaveCount(3);
  await expect(s2.locator(".tile.mine")).toContainText("Cat A");
  await expect(s2.locator(".tile.mine")).toContainText("$132,004");
  await expect(s2.locator(".lede")).toContainText("Cat A COEs");

  await page.locator("section[aria-labelledby=s3] select").first().selectOption("byd-sealion-6-dmi");
  await expect(s2.locator(".tile.mine")).toContainText("Cat B");
  await expect(s2.locator(".lede")).toContainText("Cat B COEs");
  await s2.getByRole("radio", { name: "All cars" }).click();
  await expect(s2.locator(".lede")).toContainText("Car COEs");
});

test("a car LTA lists without a price asks for a dealer quote", async ({ page }) => {
  const s3 = page.locator("section[aria-labelledby=s3]");
  await s3.locator("select").first().selectOption("jaecoo-6-ev");
  await expect(s3.locator(".results")).toContainText("Enter a dealer's quote");
  await expect(s3.locator(".results")).toContainText("Enter the car's price to work out the loan");
  await fill(page, "quotedPrice", "215,888");
  await expect(s3.locator(".results .big").first()).toHaveText("$215,888");
  await expect(s3.locator(".results")).toContainText("a month");
});
