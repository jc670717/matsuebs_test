const { test, expect } = require("@playwright/test");

test.setTimeout(900_000);

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

async function goToPassengerForm(page, seatCount) {
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
  await seatHeading.locator("xpath=following::select[1]").first().selectOption(String(seatCount));
  await page.locator('button:has-text("下一步"):visible').last().click();

  await expect(page.getByRole("heading", { name: /請填寫訂票資料/ })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("columnheader", { name: "身分證號" })).toBeVisible({ timeout: 20000 });
}

async function setTicketByContains(row, keyword) {
  const ticketSelect = row.getByRole("combobox").last();
  const value = await ticketSelect.locator("option").evaluateAll((opts, kw) => {
    const found = opts.find((o) => (o.textContent || "").includes(kw));
    return found ? found.value : null;
  }, keyword);
  if (!value) throw new Error(`找不到票種: ${keyword}`);
  await ticketSelect.selectOption(value);
}

async function submitAndGetResult(page) {
  await page.locator('button:has-text("下一步"):visible').last().click();
  await page.waitForTimeout(1200);

  const confirm = page.getByRole("heading", { name: /確認訂單內容/ });
  if (await confirm.isVisible().catch(() => false)) return { status: "PASS", detail: "" };

  const opDialog = page.getByRole("dialog", { name: /操作錯誤/ });
  if (await opDialog.isVisible().catch(() => false)) {
    const txt = await opDialog.innerText().catch(() => "操作錯誤");
    return { status: "OP_ERROR", detail: txt.replace(/\s+/g, " ").trim() };
  }

  const errTitle = page.getByRole("heading", { name: /錯誤訊息/ });
  if (await errTitle.isVisible().catch(() => false)) {
    const msg = await page.locator("h3").nth(1).innerText().catch(() => "錯誤訊息");
    return { status: "BUSINESS_ERROR", detail: msg };
  }

  return { status: "UNKNOWN", detail: `URL=${page.url()}` };
}

test("special fare rules by requested ages and pairing", async ({ page }) => {
  const cases = [
    { name: "全票", seatCount: 1, mode: "single", ticket: "全票", birth: "19800101" },
    { name: "半票-兒童", seatCount: 1, mode: "single", ticket: "半票-兒童", birth: "20190101" },
    { name: "免票-嬰幼兒", seatCount: 1, mode: "single", ticket: "免票-嬰幼兒", birth: "20250101" },
    { name: "半票-敬老", seatCount: 1, mode: "single", ticket: "半票-敬老", birth: "19560101" },
    { name: "半票-愛心", seatCount: 2, mode: "pair", firstTicket: "免票-嬰幼兒", secondTicket: "半票-愛心", firstBirth: "20250101", secondBirth: "19800101", firstName: "寶寶一號", secondName: "測試員" },
    { name: "半票-愛心陪伴", seatCount: 2, mode: "pair", firstTicket: "半票-愛心", secondTicket: "半票-愛心陪伴", firstBirth: "19800101", secondBirth: "19800101", firstName: "測試員", secondName: "王小明" },
  ];

  for (const c of cases) {
    await goToPassengerForm(page, c.seatCount);

    const passengerTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "身分證號" }) }).first();
    const orderTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "電子信箱" }) }).first();

    const rows = passengerTable.locator("tbody tr");
    const rowCount = await rows.count();

    const id1 = generateTaiwanId();
    const id2 = generateTaiwanId();

    if (c.mode === "single") {
      const r1 = rows.nth(0);
      const t1 = r1.getByRole("textbox");
      await t1.nth(0).fill(id1);
      await t1.nth(1).fill("測試員");
      await t1.nth(2).fill(c.birth);
      await setTicketByContains(r1, c.ticket);
    } else {
      if (rowCount < 2) throw new Error(`${c.name} 需要2人，但實際只有${rowCount}列`);

      const r1 = rows.nth(0);
      const t1 = r1.getByRole("textbox");
      await t1.nth(0).fill(id1);
      await t1.nth(1).fill(c.firstName || "第一人");
      await t1.nth(2).fill(c.firstBirth);
      await setTicketByContains(r1, c.firstTicket);

      const r2 = rows.nth(1);
      const t2 = r2.getByRole("textbox");
      await t2.nth(0).fill(id2);
      await t2.nth(1).fill(c.secondName || "第二人");
      await t2.nth(2).fill(c.secondBirth);
      await setTicketByContains(r2, c.secondTicket);
    }

    const orderInputs = orderTable.getByRole("textbox");
    await orderInputs.nth(0).fill(c.mode === "single" ? id1 : id2);
    await orderInputs.nth(1).fill("測試員");
    await orderInputs.nth(2).fill("jc670717@gmail.com");

    const result = await submitAndGetResult(page);
    console.log(`[RULE] ${c.name} => ${result.status}${result.detail ? ` | ${result.detail}` : ""}`);

    if (result.status !== "PASS") {
      await page.screenshot({ path: `artifacts/ticket_type_debug/rule_${c.name}.png`, fullPage: true });
      const okBtn = page.getByRole("button", { name: /確定|確認/ });
      if (await okBtn.count()) await okBtn.first().click().catch(() => {});
    }
  }
});



