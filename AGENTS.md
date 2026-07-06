# NovelReader — Agent Guide

个人 iOS 小说阅读器（自用）。完整 PRD/规范见 `docs/superpowers/specs/2026-07-05-ios-novel-reader-design.md`。

## 技术栈
- Expo SDK 57 + React Native 0.86 + React 19.2 + TypeScript（strict）
- 测试：Jest 29 + `jest-expo` preset（`npm test`）
- 装机（无 Mac，唯一准绳见 `docs/ios_sideload_route.md`）：GitHub Actions 出未签名 .ipa → Sideloadly 免费 Apple ID 签名 → SideStore 自动续签。**禁用** eas build 免费凭证管理 / AltServer / TrollStore
- 日常迭代走 **EAS Update（JS-only OTA）**：push→CI `eas update`→手机启动自动更新，免重建/重签（见 `docs/EAS_UPDATE_SETUP.md`）。原生改动才需重出 ipa。`build-unsigned-ipa.yml` 手动触发，`publish-ota-update.yml` push 触发
- 路径别名：`@/*` → `src/*`（tsconfig + jest moduleNameMapper 均已配）

> Expo 版本敏感：写原生/Expo 代码前查 https://docs.expo.dev/versions/v57.0.0/

## 开发工作流（必须遵守）
- 串行 task（T0–T8），**未通过 verify 不进入下一个**。
- 每个 task：worker(sonnet) 走 TDD（先写失败测试→实现→重构）→ reviewer(sonnet) 审阅 → verify 全绿。
- 逻辑模块（编码/解析/索引/store）用 Jest 严格断言，fixture 用 `reference/example_novels` 的 9 本真实样本。
- 装机/滚动/排版视觉等由用户真机手动 verify。

## 关键约束
- 大文件（15–20MB txt）**绝不整本进 React state**：导入时一次性建章节索引，阅读时按 offset 滑窗加载。
- 编码混杂（UTF-8 / UTF-8-BOM / GBK-GB18030），必须自动探测+转码。
- 竖屏、上下连续滑动阅读；UI 要求简洁现代高级。
