const { test, expect } = require("@playwright/test");

test.setTimeout(240_000);

function formatDatePlusDays(days) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function generateTaiwanId() {
  const map = {
    A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18,
    K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27,
    U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
  };
  const letters = Object.keys(map);
  const letter = letters[Math.floor(Math.random() * letters.length)];
  const gender = "1";
  const mid = String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0");
  const n = map[letter];
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

async function selectOptionContains(selectLocator, keyword) {
  const value = await selectLocator.evaluate((el, kw) => {
    const sel = /** @type {HTMLSelectElement} */ (el);
    const opt = Array.from(sel.options).find((o) => o.text.includes(kw));
    return opt ? opt.value : null;
  }, keyword);
  if (value !== null) await selectLocator.selectOption(value);
}

test("full purchase flow to bank redirect", async ({ page, context }) => {
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

  await expect(page.getByRole("heading", { name: /一般座位/ })).toBeVisible({ timeout: 20000 });
  await page.getByRole("combobox").first().selectOption("1");
  await page.locator('button:has-text("下一步"):visible').last().click();

  await expect(page.getByRole("heading", { name: /請填寫訂票資料/ })).toBeVisible({ timeout: 20000 });

  const passengerTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "身分證號" }) }).first();
  const orderTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "電子信箱" }) }).first();
  await expect(passengerTable).toBeVisible({ timeout: 20000 });
  await expect(orderTable).toBeVisible({ timeout: 20000 });

  const passengerInputs = passengerTable.getByRole("textbox");
  const passengerSelects = passengerTable.getByRole("combobox");
  const orderInputs = orderTable.getByRole("textbox");

  let idNo = process.env.MATSUEBS_ID || "A123456789";
  const name = process.env.MATSUEBS_NAME || "測試員";

  const fillPassengerForm = async (id) => {
    await passengerInputs.nth(0).fill(id);
    await passengerInputs.nth(1).fill(name);
    await passengerInputs.nth(2).fill("19800101");
    await selectOptionContains(passengerSelects.last(), "全票");

    const sameFirst = page.getByRole("checkbox", { name: /同第一人/ });
    if (await sameFirst.count()) await sameFirst.check();

    if (await orderInputs.nth(0).count()) {
      const idVal = await orderInputs.nth(0).inputValue();
      if (!idVal) await orderInputs.nth(0).fill(id);
    }
    if (await orderInputs.nth(1).count()) {
      const nameVal = await orderInputs.nth(1).inputValue();
      if (!nameVal) await orderInputs.nth(1).fill(name);
    }
    await orderInputs.nth(2).fill("jc670717@gmail.com");
  };

  await fillPassengerForm(idNo);
  await page.locator('button:has-text("下一步"):visible').last().click();

  const confirmTitle = page.getByText(/確認訂單內容/);
  const duplicateDialog = page.getByRole("dialog", { name: /已重覆訂票/ });

  const outcome = await Promise.race([
    confirmTitle.waitFor({ state: "visible", timeout: 10000 }).then(() => "confirm").catch(() => null),
    duplicateDialog.waitFor({ state: "visible", timeout: 10000 }).then(() => "duplicate").catch(() => null),
  ]);

  if (outcome === "duplicate") {
    await duplicateDialog.getByRole("button", { name: /確定/ }).click();
    idNo = generateTaiwanId();
    await fillPassengerForm(idNo);
    await page.locator('button:has-text("下一步"):visible').last().click();
    await expect(confirmTitle).toBeVisible({ timeout: 20000 });
  } else {
    await expect(confirmTitle).toBeVisible({ timeout: 20000 });
  }

  const popupPromise = context.waitForEvent("page", { timeout: 30000 }).catch(() => null);
  await page.getByRole("button", { name: /信用卡付款/ }).click();

  const payDialog = page.getByRole("dialog", { name: /請準備付款/ });
  await expect(payDialog).toBeVisible({ timeout: 10000 });
  await payDialog.getByRole("button", { name: "確認" }).click();

  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded");
    await expect.poll(() => new URL(popup.url()).hostname, { timeout: 40000 }).not.toContain("matsuebs.com");
  } else {
    await page.waitForLoadState("domcontentloaded");
    await expect.poll(() => new URL(page.url()).hostname, { timeout: 40000 }).not.toContain("matsuebs.com");
  }
});

