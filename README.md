# matsuebs_test

Playwright 自動化測試專案，涵蓋馬祖海上交通訂位購票流程與票種規則。

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
# 全部測試
npm test

# 全流程：選班次 -> 同意條款 -> 填資料 -> 信用卡付款跳轉
npm run test:purchase-flow

# 掃描所有票種（報表模式）
npm run test:ticket-types

# 特殊規則（全票/兒童/嬰幼兒/敬老/愛心/愛心陪伴）
npm run test:special-rules

# 專門檢查失敗票種並輸出截圖
npm run test:failed-debug
```

## 測試資料

- 預設姓名：`測試員`
- 預設 email：`jc670717@gmail.com`
- 預設路線：南竿 -> 北竿
- 預設日期：10 天後

可用環境變數覆蓋（僅部分腳本使用）：

- `MATSUEBS_ID`
- `MATSUEBS_NAME`

## 專案結構

- `tests/`: Playwright 測試腳本
- `playwright.config.js`: Playwright 設定
- `test-results/`: 測試執行輸出（已加入 `.gitignore`）
- `artifacts/`: 除錯截圖輸出（已加入 `.gitignore`）

## 注意事項

- 某些票種有業務規則限制（如團體票、縣民票、學生票等），測試腳本會記錄阻擋原因。
- 若網站規則調整，請更新對應測試條件與測試資料。

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

下載 EXE 後，解壓到資料夾並執行 `run-special-rules.cmd` 即可跑特殊規則測試。
