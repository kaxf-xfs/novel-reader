# 装机现状与对账（Canonical route）

> ⚠️ 本项目的**唯一装机准绳**是 [`ios_sideload_route.md`](./ios_sideload_route.md)：
> **GitHub Actions（macOS runner）编译未签名 .ipa → Sideloadly（Windows，免费 Apple ID 签名）→ SideStore + WireGuard 后台自动续签**。
>
> 该方案明确**禁用**：`eas build` 免费账号凭证自动管理、AltServer/AltStore（Win11 不稳）、Hackintosh/VM、TrollStore。本文旧版基于 EAS+AltStore 的说明**已作废**，一切以 `ios_sideload_route.md` 为准。

## 我已提前落地（代码侧）
- ✅ `app.json` 已设 `ios.bundleIdentifier = com.arthurwen.novelreader`（Phase 0 前置要求）。
- ✅ `.github/workflows/build-unsigned-ipa.yml` 已按 route 的 Phase 1 建好——push 到 `main` 或手动 `workflow_dispatch` 即可产出 `unsigned.ipa` artifact，无需任何 Apple Secrets。
- ✅ `expo-sqlite` 已在 `app.json` plugins 中声明，`expo prebuild` 会自动配好 pod。

## 你需要做的手动步骤（按 route 顺序）
1. **Phase 0**：注册一个专用免费 Apple ID；iPhone 开启开发者模式；把本仓库 push 到 GitHub（建议 public 以免 macOS runner 分钟数限制）。
2. **Phase 1**：在 GitHub 网页手动 Run 一次 `Build Unsigned iOS IPA` workflow，下载 `unsigned.ipa`。
3. **Phase 2**：Windows 装 Sideloadly，用免费 Apple ID 签名安装到 iPhone；设置里「信任」开发者。
4. **Phase 3**：装 SideStore + WireGuard，配好 `.mobiledevicepairing`，实现 7 天自动续签。

## T0 手动 verify（装上后确认）
- 冷启动 App 看到深色占位屏 `NovelReader / 沉浸阅读 · 极简排版` 即通过。

## 关于「长期更新」
- **默认**：改代码 → push → Actions 出新 `unsigned.ipa` → Sideloadly 重新签名安装一次（route 维护清单）。
- **可选增强（不属于 route，需你点头再加）**：`EAS Update` 可做 **JS-only OTA**——大多数迭代（UI/逻辑）不改原生时可空中推送、免重新签名安装；仅新增原生模块时才需重新走上面的 rebuild。它与签名方式无关，不违反 route 的禁用项。要不要引入由你决定。

## 备注
- `eas.json` 目前在本 route 中**未被使用**（保留仅为将来若改付费 TestFlight 备用）。
