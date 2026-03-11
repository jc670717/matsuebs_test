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

async function waitBodyReady(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("body").waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const body = document.body;
    if (!body) return false;
    const style = window.getComputedStyle(body);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

async function clickRouteNext(page) {
  await waitBodyReady(page);
  const nextByRole = page.getByRole("button", { name: /下一步/ }).last();
  if (await nextByRole.count()) {
    await nextByRole.click({ force: true });
    await waitBodyReady(page);
    return;
  }

  const nextByText = page.locator('button:has-text("下一步")').last();
  if (await nextByText.count()) {
    await nextByText.click({ force: true });
    await waitBodyReady(page);
    return;
  }

  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const target = btns.find((b) => (b.innerText || "").includes("下一步"));
    if (!target) return false;
    target.click();
    return true;
  });
  if (clicked) {
    await waitBodyReady(page);
    return;
  }

  throw new Error("找不到下一步按鈕");
}

async function goToPassengerForm(page, seatCount) {
  await page.goto("https://www.matsuebs.com/home/SelectShip", { waitUntil: "domcontentloaded" });
  await waitBodyReady(page);

  const ack = page.getByText("已閱", { exact: true });
  if (await ack.count()) await ack.first().click({ timeout: 10000 });

  await page.locator("select").first().selectOption({ label: "單程" });
  await page.selectOption('select[name="StartStation"]', { label: "基隆" });
  await page.selectOption('select[name="EndStation"]', { label: "南竿" });

  // 1) 選完抵達後先等班次出來
  await expect(async () => {
    const remainCount = await page.locator("button").filter({ hasText: "剩位" }).count();
    expect(remainCount).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 20000 });

  // 2) 點日期元件，選指定日期
  const targetDate = formatDatePlusDays(3);
  const dateInput = page.locator('input[name="StartDate"]').first();
  await dateInput.click({ force: true });
  const day = String(Number(targetDate.slice(-2)));
  const dayCell = page.locator(".datepicker-days td.day:not(.old):not(.new)").filter({ hasText: day }).first();
  if (await dayCell.count()) {
    await dayCell.click({ force: true });
  } else {
    await setInputValue(page, 'input[name="StartDate"]', targetDate);
  }
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await expect(dateInput).toHaveValue(targetDate, { timeout: 10000 });

  // 3) 再等班次更新完成
  const processing = page.getByRole("dialog", { name: /處理中/ });
  if (await processing.count()) {
    await processing.first().waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  }
  await expect(async () => {
    const rowCount = await page.locator("tr").count();
    const remainCount = await page.locator("button").filter({ hasText: "剩位" }).count();
    expect(rowCount).toBeGreaterThanOrEqual(2);
    expect(remainCount).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 20000 });

  // 4) 選那個班次（第一筆剩位）再下一步
  const remainBtn = page.locator("button").filter({ hasText: "剩位" }).first();
  await waitBodyReady(page);
  await remainBtn.click({ force: true });
  await expect(async () => {
    const nextCount = await page.getByRole("button", { name: /下一步/ }).count();
    expect(nextCount).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 10000 });
  await clickRouteNext(page);

  const statement = page.getByRole("heading", { name: /個人資料蒐集前告知聲明/ });
  if (await statement.isVisible().catch(() => false)) {
    await waitBodyReady(page);
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const els = Array.from(document.querySelectorAll("*"));
      for (const el of els) {
        if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      }
    });
    const agree = page.getByRole("checkbox").first();
    await agree.check({ force: true });
    await clickRouteNext(page);
  }

  const berth = page.locator('xpath=//*[contains(normalize-space(.),"臥鋪(單)")]/following::select[1]').first();
  if (await berth.isVisible().catch(() => false)) {
    await waitBodyReady(page);
    await berth.selectOption(String(seatCount));
    await clickRouteNext(page);
  }

  await expect(page.getByRole("heading", { name: /請填寫訂票資料/ })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("columnheader", { name: "身分證號" })).toBeVisible({ timeout: 20000 });
}

async function setTicketByContains(row, ticketText) {
  const ticketSelect = row.getByRole("combobox").last();
  const value = await ticketSelect.locator("option").evaluateAll((opts, targetText) => {
    const normalize = (s) => (s || "").replace(/\s+/g, "").trim();
    const target = normalize(targetText);
    const found = opts.find((o) => normalize(o.textContent || "").includes(target));
    return found ? found.value : null;
  }, ticketText);

  if (!value) throw new Error(`找不到票種: ${ticketText}`);
  await ticketSelect.selectOption(value);
}

async function submitAndGetResult(page) {
  await waitBodyReady(page);
  await clickRouteNext(page);
  await page.waitForTimeout(1200);

  const confirm = page.getByRole("heading", { name: /確認訂單內容/ });
  const onConfirmPage = /\/Home\/confirmPassenger/i.test(page.url());
  if (onConfirmPage || await confirm.isVisible().catch(() => false)) {
    return { status: "PASS", detail: onConfirmPage ? `URL=${page.url()}` : "" };
  }

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

test("taima route: keelung to nangan, first sailing, berth single, fare list", async ({ page }) => {
  const cases = [
    { name: "全票", seatCount: 1, mode: "single", ticket: "全票", birth: "19800101" },
    { name: "半票-兒童", seatCount: 1, mode: "single", ticket: "半票-兒童", birth: "20190101" },
    { name: "半票-敬老", seatCount: 1, mode: "single", ticket: "半票-敬老", birth: "19560101" },
    { name: "半票-愛心陪伴", seatCount: 2, mode: "pair", firstTicket: "半票-愛心", secondTicket: "半票-愛心陪伴", firstBirth: "19800101", secondBirth: "19800101", firstName: "測試員", secondName: "王小明" },
  ];

  for (const c of cases) {
    try {
      await goToPassengerForm(page, c.seatCount);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      console.log(`[TAIMA] ${c.name} => BLOCKED | ${formatDatePlusDays(3)} 基隆->南竿 | ${msg}`);
      continue;
    }

    try {
      const passengerTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "身分證號" }) }).first();
      const orderTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "電子信箱" }) }).first();

      const id1 = generateTaiwanId();
      const id2 = generateTaiwanId();
      const rows = passengerTable.locator("tbody tr");
      const rowCount = await rows.count();

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
      console.log(`[TAIMA] ${c.name} => ${result.status}${result.detail ? ` | ${result.detail}` : ""}`);

      if (result.status !== "PASS") {
        await page.screenshot({ path: `artifacts/ticket_type_debug/taima_${c.name}.png`, fullPage: true });
        const okBtn = page.getByRole("button", { name: /確定|確認/ });
        if (await okBtn.count()) await okBtn.first().click().catch(() => {});
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      console.log(`[TAIMA] ${c.name} => BLOCKED | ${formatDatePlusDays(3)} 基隆->南竿 | ${msg}`);
      continue;
    }
  }
});
