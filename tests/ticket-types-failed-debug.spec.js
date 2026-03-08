const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

test.setTimeout(900_000);

const TARGET_FARES = [
  "半票-兒童-NT$80",
  "半票-敬老-NT$80",
  "半票-愛心陪伴-NT$80",
  "免票-嬰幼兒票-NT$0",
  "北竿學生票-NT$0",
  "縣民-愛心陪伴-NT$0",
];

function formatDatePlusDays(days) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function generateTaiwanId() {
  const n = 10; // A
  const gender = "1";
  const mid = String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0");
  const head = [Math.floor(n / 10), n % 10];
  const body = (gender + mid).split("").map((c) => Number(c));
  const weighted = head[0] * 1 + head[1] * 9
    + body[0] * 8 + body[1] * 7 + body[2] * 6 + body[3] * 5
    + body[4] * 4 + body[5] * 3 + body[6] * 2 + body[7] * 1;
  const check = (10 - (weighted % 10)) % 10;
  return `A${gender}${mid}${check}`;
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
  await seatHeading.locator("xpath=following::select[1]").first().selectOption("1");
  await page.locator('button:has-text("下一步"):visible').last().click();

  await expect(page.getByRole("heading", { name: /請填寫訂票資料/ })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("columnheader", { name: "身分證號" })).toBeVisible({ timeout: 20000 });
}

test("debug failed fare types", async ({ page }) => {
  const outDir = path.join(process.cwd(), "artifacts", "ticket_type_debug");
  fs.mkdirSync(outDir, { recursive: true });

  const rows = [];

  for (let i = 0; i < TARGET_FARES.length; i++) {
    const fare = TARGET_FARES[i];
    await goToPassengerForm(page);

    const passengerTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "身分證號" }) }).first();
    const orderTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "電子信箱" }) }).first();

    const passengerInputs = passengerTable.getByRole("textbox");
    const ticketSelect = passengerTable.getByRole("combobox").last();
    const orderInputs = orderTable.getByRole("textbox");

    const idNo = generateTaiwanId();
    await passengerInputs.nth(0).fill(idNo);
    await passengerInputs.nth(1).fill("測試員");
    await passengerInputs.nth(2).fill("19800101");

    const targetValue = await ticketSelect.locator("option").evaluateAll((opts, target) => {
      const found = opts.find((o) => (o.textContent || "").trim().includes(target));
      return found ? found.value : null;
    }, fare);

    if (!targetValue) {
      rows.push({ fare, status: "NOT_FOUND", detail: "票種選項不存在" });
      continue;
    }

    await ticketSelect.selectOption(targetValue);
    await orderInputs.nth(0).fill(idNo);
    await orderInputs.nth(1).fill("測試員");
    await orderInputs.nth(2).fill("jc670717@gmail.com");

    await page.locator('button:has-text("下一步"):visible').last().click();

    await page.waitForTimeout(1200);

    const confirmVisible = await page.getByRole("heading", { name: /確認訂單內容/ }).isVisible().catch(() => false);
    const dupDialog = page.getByRole("dialog", { name: /已重覆訂票/ });
    const dupVisible = await dupDialog.isVisible().catch(() => false);
    const opDialog = page.getByRole("dialog", { name: /操作錯誤/ });
    const opVisible = await opDialog.isVisible().catch(() => false);
    const errHeadingVisible = await page.getByRole("heading", { name: /錯誤訊息/ }).isVisible().catch(() => false);

    let status = "UNKNOWN";
    let detail = "";

    if (confirmVisible) {
      status = "PASS";
    } else if (dupVisible) {
      status = "DUPLICATE";
      detail = await dupDialog.locator("div").nth(2).innerText().catch(() => "已重覆訂票");
      await dupDialog.getByRole("button", { name: /確定/ }).click().catch(() => {});
    } else if (opVisible) {
      status = "OP_ERROR";
      detail = await opDialog.innerText().catch(() => "操作錯誤");
      await opDialog.getByRole("button", { name: /確定/ }).click().catch(() => {});
    } else if (errHeadingVisible) {
      status = "BUSINESS_ERROR";
      detail = await page.locator("h3").nth(1).innerText().catch(() => "錯誤訊息");
      const btn = page.getByRole("button", { name: /確認/ });
      if (await btn.count()) await btn.first().click().catch(() => {});
    } else {
      const bodySnippet = (await page.locator("body").innerText().catch(() => "")).slice(0, 300);
      detail = `No known state. URL=${page.url()} SNIPPET=${bodySnippet}`;
    }

    const shot = path.join(outDir, `${String(i + 1).padStart(2, "0")}_${fare.replace(/[\\/:*?"<>|\s]+/g, "_")}.png`);
    await page.screenshot({ path: shot, fullPage: true });

    rows.push({ fare, status, detail, screenshot: shot });
  }

  for (const r of rows) {
    console.log(`[DEBUG] ${r.fare} => ${r.status}${r.detail ? ` | ${r.detail}` : ""}`);
    if (r.screenshot) console.log(`[SHOT] ${r.screenshot}`);
  }
});

