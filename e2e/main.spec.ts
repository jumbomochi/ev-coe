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

test.beforeEach(async ({ page }) => {
  await page.goto(`/?today=${TODAY}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("replacing owner: window, deregister value, renewal and plan strips", async ({ page }) => {
  await fill(page, "registrationDate", "2018-10-15");
  await fill(page, "coeExpiryDate", "2028-10-14");
  await fill(page, "arfPaid", "20,000");
  await fill(page, "quotaPremiumPaid", "26,000");

  const results = page.locator("section[aria-labelledby=s1] .results");
  await expect(results).toContainText("Now → 14 Oct 2028");
  await expect(results).toContainText("$16,091");
  await expect(results).toContainText("PARF $11,000 + COE rebate $5,091");
  await expect(results).toContainText("10 years: $129,883");
  await expect(results).toContainText("5 years: $64,942");
  await expect(results).toContainText("gives up $10,000 of PARF");

  await expect(page.locator("section[aria-labelledby=s2] svg").first()).toBeVisible();

  const plans = page.locator("section[aria-labelledby=s4]");
  await expect(plans.locator("h3")).toHaveText(["Buy when your COE expires", "Renew 5 years, then buy", "Buy a year early"]);
  await expect(plans).toContainText("N = 242");
});

test("first-car buyer: target month and the single history strip", async ({ page }) => {
  await page.getByRole("radio", { name: "No, this is my first car" }).click();
  await fill(page, "targetMonth", "2027-06");
  const plans = page.locator("section[aria-labelledby=s4]");
  await expect(plans.locator("h2")).toHaveText("What buying in your month has cost");
  await expect(plans.locator("h3")).toHaveText(["Buy in your target month"]);
  await expect(plans).toContainText("N = 398");
});

test("impossible input shows a message, not figures", async ({ page }) => {
  await fill(page, "registrationDate", "2018-10-15");
  await fill(page, "coeExpiryDate", "2017-01-01");
  await expect(page.locator("label:has(input[name=coeExpiryDate]) .error")).toHaveText("COE expiry must be after registration");
  await expect(page.locator("section[aria-labelledby=s1] .results")).toHaveClass(/empty/);
});

test("Clear my car forgets the profile after a reload", async ({ page }) => {
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
  await expect(s2.locator(".lede")).toContainText("car COEs");
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
