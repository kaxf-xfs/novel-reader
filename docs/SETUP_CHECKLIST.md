# 装机 + OTA 一次性设置清单（按顺序做）

> 目标：把 App 装上你的 iPhone（免费、无 Mac），并让日常更新走 OTA。
> 详细原理见 `ios_sideload_route.md` 与 `EAS_UPDATE_SETUP.md`，本清单是可打勾的操作顺序。

## A. 本地 Git（我可代做，你说一声）
- [ ] A1. `/reference` 已加入 .gitignore（版权小说不上传）——✅ 已做
- [ ] A2. 提交所有代码：`git add -A && git commit -m "NovelReader backend T0–T3 + CI + OTA config"`

## B. 推到 GitHub（建议 public，macOS runner 免费不限量）
- [ ] B1. 首次用 gh 登录：`gh auth login`（选 GitHub.com → HTTPS → 浏览器授权）
- [ ] B2. 建仓库并推送：
  ```
  gh repo create novel-reader --public --source=. --remote=origin --push
  ```
  （若想私有改 `--private`，注意每月约 2000 分钟、macOS 按 10× 计的免费额度）

## C. Expo / EAS Update 账号配置（拿到 OTA 端点）
- [ ] C1. 装 CLI 并登录（注册免费 Expo 账号）：`npm i -g eas-cli` → `eas login`
- [ ] C2. `eas init`（写入 extra.eas.projectId）
- [ ] C3. `eas update:configure`（写入 updates.url = https://u.expo.dev/<projectId>）
- [ ] C4. 打开 app.json 确认：`updates.url` 和 `extra.eas.projectId` 已填；且 `runtimeVersion.policy=fingerprint`、`updates.requestHeaders.expo-channel-name=production` 仍在（被覆盖就补回）
- [ ] C5. 提交并推送：`git add app.json && git commit -m "eas update config" && git push`
- [ ] C6. 生成 CI 令牌：expo.dev → Account → Access Tokens 新建 → 复制，然后
  ```
  gh secret set EXPO_TOKEN
  ```
  （粘贴令牌值；或在 GitHub 网页 Settings → Secrets → Actions 里加 `EXPO_TOKEN`）

## D. 首次原生构建（GitHub Actions 出未签名 ipa）
- [ ] D1. iPhone 开开发者模式：设置 → 隐私与安全性 → 开发者模式 → 打开（会重启）
- [ ] D2. GitHub 仓库 → Actions → 选 "Build Unsigned iOS IPA" → Run workflow（手动触发）
- [ ] D3. 跑绿后进 run 页面 → Artifacts → 下载 `unsigned-ipa`（解压得 `unsigned.ipa`）
  - 若 scheme 检测失败：看 `ios_sideload_route.md` 的调试提示

## E. Sideloadly 免费签名装机（T0 真机 verify）
- [ ] E1. 注册一个**专用**免费 Apple ID（别用主号）；建议生成 App 专用密码
- [ ] E2. 官网装 Sideloadly（https://sideloadly.io/），按提示装 Apple 驱动组件
- [ ] E3. 数据线连手机、信任电脑；把 `unsigned.ipa` 拖进 Sideloadly，填 Apple ID → Start
- [ ] E4. 设置 → 通用 → VPN与设备管理 → 点你的 Apple ID → 信任
- [ ] E5. ✅ 冷启动 App，看到深色占位屏 `NovelReader / 沉浸阅读 · 极简排版` → **T0 通过，回来告诉我**

## F. SideStore 自动续签（免去每 7 天手动重装）
- [ ] F1. 下载 Jitterbugpair（Win 64-bit）→ USB 连机 → 运行生成 `.mobiledevicepairing`
- [ ] F2. 用 Sideloadly 把 `SideStore.ipa`（官方 Release）也签名装上（占 3 个名额之一）
- [ ] F3. App Store 免费装 WireGuard
- [ ] F4. 打开 SideStore → 下载它的 WireGuard 配置导入并常开 VPN → 导入 `.mobiledevicepairing`
- [ ] F5. 完成后 SideStore 后台临期自动无线续签

## G. 验证 OTA（可选，装完再试）
- [ ] G1. 改一处占位屏文案 → `git push`
- [ ] G2. Actions 的 "Publish OTA Update" 跑绿 → 手机完全退出 App 再开两次 → 文案变了即 OTA 成功

---

## 完成 E5 后
回来找我，我们开始 **T4 阅读页**（竖向滑动 + 滑窗加载 + 进度），边做边用 OTA 在你真机上看效果。
