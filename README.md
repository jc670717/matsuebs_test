# matsuebs_test

Playwright 自動化測試專案，目前保留兩支實際使用中的測試：

- `island`: 南竿 -> 北竿票種規則測試
- `taima`: 基隆 -> 南竿臥鋪訂位流程測試

## 環境需求

- Node.js 18+
- npm 9+
- Windows / macOS / Linux

## 快速開始

```bash
npm install
npx playwright install chromium
```

## 可用指令

```bash
# island：南竿 -> 北竿票種規則
npm run test:island

# island：headed 模式
npm run test:island:headed

# taima：基隆 -> 南竿，臥鋪流程
npm run test:taima
```

## 測試資料

- 預設姓名：`測試員`
- 預設 email：`jc670717@gmail.com`
- `island` 預設路線：南竿 -> 北竿
- `taima` 預設路線：基隆 -> 南竿
- `island` 預設日期：10 天後
- `taima` 預設日期：3 天後

## 專案結構

- `tests/island.js`: island 測試
- `tests/taima.js`: taima 測試
- `playwright.config.js`: Playwright 設定
- `test-results/`: 測試執行輸出（已加入 `.gitignore`）
- `artifacts/`: 除錯截圖輸出（已加入 `.gitignore`）

## 注意事項

- 若網站規則調整，請更新對應測試條件與測試資料。
- `taima` 會真的透過日期元件選日期，再進行艙位選擇與乘客資料流程。

## GitHub Tag 自動打包 EXE

此專案已設定 GitHub Actions：

- 觸發條件：`push tag`，且 tag 名稱符合 `v*`（例如 `v1.0.0`）
- 產物：Windows 自解壓執行檔 `matsuebs_test-<tag>-win-x64.exe`
- 發佈位置：該 tag 的 GitHub Release Assets

### 如何觸發

```bash
git tag v1.0.0
git push origin v1.0.0
```

下載 EXE 後，解壓到資料夾並執行 `run-island.cmd` 即可跑 `island` 測試。
