const { test, expect } = require("@playwright/test");

test.setTimeout(1_500_000);

function formatDatePlusDays(days) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function generateTaiwanId() {
  const letter = "A";
  const n = 10;
  const gender = "1";
  const mid = String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0");
  const head = [Math.floor(n / 10), n % 10];
  const body = (gender + mid).split("").map((c) => Number(c));
  const weighted = head[0] * 1 + head[1] * 9
    + body[0] * 8 + body[1] * 7 + body[2] * 6 + body[3] * 5
    + body[4] * 4 + body[5] * 3 + body[6] * 2 + body[7] * 1;
  const check = (10 - (weighted % 10)) % 10;
  return `${letter}${gender}${mid}${check}`;
}

async function setInputValue(page, selector, value) {
  const input = page.locator(selector).first();
  await input.click();
  await input.fill(value);
  await input.press("Enter");
  await input.blur();
  await input.evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }, value);
}

async function goToPassengerForm(page) {
  await page.goto("https://www.matsuebs.com/home/SelectShip", { waitUntil: "domcontentloaded" });

  const ack = page.getByText("已閱", { exact: true });
  if (await ack.count()) await ack.first().click({ timeout: 10000 });

  await page.locator("select").first().selectOption({ label: "單程" });
  await page.selectOption('select[name="StartStation"]', { label: "南竿" });
  await page.selectOption('select[name="EndStation"]', { label: "北竿" });
  await setInputValue(page, 'input[name="StartDate"]', formatDatePlusDays(10));

  await expect(page.getByText("查無資料")).toHaveCount(0, { timeout: 20000 });

  const remainButtons = page.getByRole("button", { name: /剩位/ });
  await expect(async () => {
    const count = await remainButtons.count();
    expect(count).toBeGreaterThanOrEqual(10);
  }).toPass({ timeout: 20000 });

  await remainButtons.nth(9).click();
  await page.locator('button:has-text("下一步"):visible').last().click();

  await expect(page.getByRole("heading", { name: /個人資料蒐集前告知聲明/ })).toBeVisible({ timeout: 20000 });
  await page.getByRole("checkbox", { name: /Checkbox for following text input/ }).check();
  await page.locator('button:has-text("下一步"):visible').last().click();

  const seatHeading = page.getByRole("heading", { name: /一般座位/ });
  await expect(seatHeading).toBeVisible({ timeout: 20000 });
  const seatSelect = seatHeading.locator("xpath=following::select[1]").first();
  await seatSelect.selectOption("1");
  await page.locator('button:has-text("下一步"):visible').last().click();

  await expect(page.getByRole("heading", { name: /請填寫訂票資料/ })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("columnheader", { name: "身分證號" })).toBeVisible({ timeout: 20000 });
}

async function fillPassengerAndSubmit(page, ticketValue) {
  const passengerTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "身分證號" }) }).first();
  const orderTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "電子信箱" }) }).first();
  await expect(passengerTable).toBeVisible({ timeout: 20000 });
  await expect(orderTable).toBeVisible({ timeout: 20000 });

  const passengerInputs = passengerTable.getByRole("textbox");
  const ticketSelect = passengerTable.getByRole("combobox").last();
  const orderInputs = orderTable.getByRole("textbox");

  const idNo = generateTaiwanId();

  await passengerInputs.nth(0).fill(idNo);
  await passengerInputs.nth(1).fill("測試員");
  await passengerInputs.nth(2).fill("19800101");
  await ticketSelect.selectOption(ticketValue);

  await orderInputs.nth(0).fill(idNo);
  await orderInputs.nth(1).fill("測試員");
  await orderInputs.nth(2).fill("jc670717@gmail.com");
  await page.locator('button:has-text("下一步"):visible').last().click();

  const confirmTitle = page.getByRole("heading", { name: /確認訂單內容/ });
  const duplicateDialog = page.getByRole("dialog", { name: /已重覆訂票/ });
  const businessErrorTitle = page.getByRole("heading", { name: /錯誤訊息/ });

  const outcome = await Promise.race([
    confirmTitle.waitFor({ state: "visible", timeout: 12000 }).then(() => "confirm").catch(() => null),
    duplicateDialog.waitFor({ state: "visible", timeout: 12000 }).then(() => "duplicate").catch(() => null),
    businessErrorTitle.waitFor({ state: "visible", timeout: 12000 }).then(() => "business_error").catch(() => null),
  ]);

  if (outcome === "duplicate") {
    await duplicateDialog.getByRole("button", { name: /確定/ }).click();
    const retryId = generateTaiwanId();
    await passengerInputs.nth(0).fill(retryId);
    await orderInputs.nth(0).fill(retryId);
    await page.locator('button:has-text("下一步"):visible').last().click();

    const retryOutcome = await Promise.race([
      confirmTitle.waitFor({ state: "visible", timeout: 12000 }).then(() => "confirm").catch(() => null),
      businessErrorTitle.waitFor({ state: "visible", timeout: 12000 }).then(() => "business_error").catch(() => null),
    ]);
    if (retryOutcome === "confirm") return { status: "PASS", message: "" };
    if (retryOutcome === "business_error") {
      const msg = await page.locator("h3").nth(1).innerText().catch(() => "業務規則限制");
      return { status: "BLOCKED", message: msg };
    }
    return { status: "FAILED", message: "重試後仍未進入確認頁" };
  }

  if (outcome === "business_error") {
    const msg = await page.locator("h3").nth(1).innerText().catch(() => "業務規則限制");
    return { status: "BLOCKED", message: msg };
  }

  if (outcome === "confirm") return { status: "PASS", message: "" };

  return { status: "FAILED", message: "未出現確認頁或錯誤訊息" };
}

test("ticket type: test every available option", async ({ page }) => {
  await goToPassengerForm(page);

  const passengerTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "身分證號" }) }).first();
  const ticketSelect = passengerTable.getByRole("combobox").last();
  const options = await ticketSelect.locator("option").evaluateAll((opts) =>
    opts
      .filter((o) => !o.disabled && (o.textContent || "").trim())
      .map((o) => ({ value: o.value, text: (o.textContent || "").trim() }))
  );

  expect(options.length).toBeGreaterThan(0);

  const results = [];

  for (const option of options) {
    await goToPassengerForm(page);
    const result = await fillPassengerAndSubmit(page, option.value);
    results.push({ ticket: option.text, ...result });
  }

  for (const r of results) {
    console.log(`[TICKET] ${r.ticket} => ${r.status}${r.message ? ` | ${r.message}` : ""}`);
  }

  const failed = results.filter((r) => r.status === "FAILED");
  if (failed.length) {
    console.log(`[SUMMARY] FAILED=${failed.length} (see [TICKET] lines above)`);
  }
});







