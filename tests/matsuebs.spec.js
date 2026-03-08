const { test, expect } = require("@playwright/test");

test("matsuebs home page loads", async ({ page }) => {
  const response = await page.goto("https://www.matsuebs.com/", { waitUntil: "domcontentloaded" });

  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/matsuebs\.com/i);
  await expect(page).toHaveTitle(/馬祖海上交通訂位購票系統/);
  await expect(page.locator("body")).toContainText("訂位");
});
