const fs = require("fs");
const path = require("path");
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

function ensureDebugDir() {
  const dir = path.join("artifacts", "ticket_type_debug");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slugifyName(value) {
  return String(value)
    .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function captureDebugArtifacts(page, label, stage) {
  const dir = ensureDebugDir();
  const base = `taima_${slugifyName(label)}_${slugifyName(stage)}`;
  const screenshotPath = path.join(dir, `${base}.png`);
  const htmlPath = path.join(dir, `${base}.html`);
  const summaryPath = path.join(dir, `${base}.txt`);

  const visibleHeadings = await page.locator("h1, h2, h3, h4, h5").evaluateAll((els) =>
    els.map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)
  ).catch(() => []);
  const visibleButtons = await page.locator("button:visible").evaluateAll((els) =>
    els.map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)
  ).catch(() => []);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const summary = [
    `stage=${stage}`,
    `url=${page.url()}`,
    `title=${await page.title().catch(() => "")}`,
    `headings=${JSON.stringify(visibleHeadings)}`,
    `buttons=${JSON.stringify(visibleButtons)}`,
    "",
    bodyText.slice(0, 4000),
  ].join("\n");

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  await fs.promises.writeFile(htmlPath, await page.content().catch(() => ""), "utf8").catch(() => {});
  await fs.promises.writeFile(summaryPath, summary, "utf8").catch(() => {});

  return { screenshotPath, htmlPath, summaryPath };
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

async function selectDateFromPicker(page, targetDate) {
  const dateInput = page.locator('input[name="StartDate"]').first();
  const day = String(Number(targetDate.slice(-2)));
  const picker = page.locator(".datepicker-days").first();
  const dayCell = page.locator(".datepicker-days td.day:not(.old):not(.new)").filter({ hasText: day }).first();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dateInput.click({ force: true });
    await picker.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    if (await dayCell.isVisible().catch(() => false)) {
      await dayCell.click({ force: true });
      await expect(dateInput).toHaveValue(targetDate, { timeout: 10000 });
      return;
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
  }

  throw new Error(`日期元件未成功展開: ${targetDate}`);
}

async function clickRouteNext(page) {
  await waitBodyReady(page);
  const nextVisible = page.locator('button:visible').filter({ hasText: "下一步" }).last();
  if (await nextVisible.count()) {
    await nextVisible.click({ force: true });
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

async function acceptStatementIfPresent(page) {
  const statement = page.getByRole("heading", { name: /個人資料蒐集前告知聲明/ });
  if (!await statement.isVisible().catch(() => false)) return;

  await expect(statement).toBeVisible({ timeout: 20000 });
  await waitBodyReady(page);
  await page.waitForTimeout(1000);
  const agree = page.getByRole("checkbox", { name: /Checkbox for following text input/ });
  const nextButton = page.locator('button:has-text("下一步"):visible').last();
  await expect(agree).toBeVisible({ timeout: 10000 });
  await expect(nextButton).toBeVisible({ timeout: 10000 });
  await agree.check();
  await expect(agree).toBeChecked({ timeout: 10000 });
  await nextButton.click();
}

async function goToPassengerForm(page, seatCount) {
  await page.goto("https://www.matsuebs.com/home/SelectShip", { waitUntil: "domcontentloaded" });
  await waitBodyReady(page);

  const ack = page.getByText("已閱", { exact: true });
  if (await ack.count()) await ack.first().click({ timeout: 10000 });

  await page.locator("select").first().selectOption({ label: "單程" });
  await page.selectOption('select[name="StartStation"]', { label: "基隆" });
  await page.selectOption('select[name="EndStation"]', { label: "南竿" });

  // 1) 點日期元件，選指定日期
  const targetDate = formatDatePlusDays(3);
  await selectDateFromPicker(page, targetDate);

  // 2) 等班次更新完成
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

  // 3) 選那個班次（第一筆剩位）再下一步
  const remainBtn = page.locator("button").filter({ hasText: "剩位" }).first();
  await waitBodyReady(page);
  await remainBtn.click({ force: true });
  console.log(`[TAIMA] route selected | ${targetDate} 基隆->南竿`);
  await page.waitForTimeout(500);
  await clickRouteNext(page);

  await acceptStatementIfPresent(page);

  const chooseBoatFlightHeading = page.getByRole("heading", { name: /去程船班/ });
  const passengerHeading = page.getByRole("heading", { name: /請填寫訂票資料/ });
  await expect(async () => {
    const onChooseBoatFlight = await chooseBoatFlightHeading.isVisible().catch(() => false);
    const onPassengerForm = await passengerHeading.isVisible().catch(() => false);
    expect(onChooseBoatFlight || onPassengerForm).toBeTruthy();
  }).toPass({ timeout: 20000 });

  if (await chooseBoatFlightHeading.isVisible().catch(() => false)) {
    const berthHeading = page.getByRole("heading", { name: /臥鋪\(單\)/ });
    await expect(berthHeading).toBeVisible({ timeout: 20000 });
    const berthSelect = berthHeading.locator("xpath=following::select[1]").first();
    await expect(berthSelect).toBeVisible({ timeout: 20000 });
    console.log(`[TAIMA] berth page reached | seatCount=${seatCount}`);
    await berthSelect.selectOption(String(seatCount));
    console.log(`[TAIMA] berth selected | 臥鋪(單)=${seatCount}`);
    await page.waitForTimeout(500);
    await clickRouteNext(page);
  }

  await expect(passengerHeading).toBeVisible({ timeout: 40000 });
  console.log("[TAIMA] passenger form reached");
  const passengerTable = page.locator("table").filter({ hasText: "身分證號" }).first();
  await expect(passengerTable).toBeVisible({ timeout: 40000 });
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

test("taima route: keelung to nangan, first sailing, berth single, fare list", async ({ browser }) => {
  const cases = [
    { name: "全票", seatCount: 1, mode: "single", ticket: "全票", birth: "19800101" },
    { name: "半票-兒童", seatCount: 1, mode: "single", ticket: "半票-兒童", birth: "20190101" },
    { name: "半票-敬老", seatCount: 1, mode: "single", ticket: "半票-敬老", birth: "19560101" },
    { name: "半票-愛心陪伴", seatCount: 2, mode: "pair", firstTicket: "半票-愛心", secondTicket: "半票-愛心陪伴", firstBirth: "19800101", secondBirth: "19800101", firstName: "測試員", secondName: "王小明" },
  ];

  for (const c of cases) {
    const page = await browser.newPage();
    try {
      await goToPassengerForm(page, c.seatCount);
      const passengerTable = page.locator("table").filter({ hasText: "身分證號" }).first();
      const orderTable = page.locator("table").filter({ hasText: "電子信箱" }).first();

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
      const debug = await captureDebugArtifacts(page, c.name, "blocked");
      console.log(`[TAIMA] ${c.name} debug => ${debug.summaryPath}`);
      console.log(`[TAIMA] ${c.name} => BLOCKED | ${formatDatePlusDays(3)} 基隆->南竿 | ${msg}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
});
