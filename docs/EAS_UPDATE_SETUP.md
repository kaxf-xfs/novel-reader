# EAS Update（JS-only OTA）一次性设置

目的：日常纯 JS/TS 改动 → push → CI 自动发布 OTA → 手机下次启动秒级更新，**无需 GitHub Actions 原生重建、无需插线用 Sideloadly 重签**。原生改动（新增原生模块 / 改 app.json 原生配置 / 升 SDK）才需重新走 `build-unsigned-ipa.yml` + Sideloadly。

## 已由代码侧配好（无需你动）
- ✅ `expo-updates` 已安装。
- ✅ `app.json`：`runtimeVersion.policy = fingerprint`（原生指纹变了 OTA 才会失配，防止把不兼容的 JS 推给旧原生包）；`updates.checkAutomatically = ON_LOAD`；`updates.requestHeaders.expo-channel-name = production`（让非 EAS Build 的 prebuild 构建订阅 `production` channel）。
- ✅ `.github/workflows/publish-ota-update.yml`：push 到 main 自动 `eas update --branch production`。
- ✅ `build-unsigned-ipa.yml` 改为**手动触发**（原生重建刻意为之）。

## 你要做的一次性步骤
1. **登录 Expo（免费账号）**：本地 `npm i -g eas-cli` → `eas login`。
2. **初始化 + 配置 Update**：在项目根目录跑
   ```
   eas init                # 创建 EAS 项目，写入 extra.eas.projectId
   eas update:configure    # 写入 updates.url（https://u.expo.dev/<projectId>）
   ```
   跑完检查 `app.json`：`updates.url` 已填、`extra.eas.projectId` 已填，且我们预设的 `runtimeVersion.fingerprint` 与 `requestHeaders` 仍在（若被覆盖，手动补回）。
3. **建 production channel↔branch 映射**：
   ```
   eas channel:create production   # 若尚不存在
   eas branch:create production    # 若尚不存在
   ```
   （`eas update --branch production` 首次发布会自动建 branch；channel 与同名 branch 默认关联。）
4. **给 CI 配令牌**：Expo 网站 → Account → Access Tokens 生成一个 token → 到本仓库 GitHub → Settings → Secrets and variables → Actions → 新建 `EXPO_TOKEN`。

## 顺序很重要
- **先** 完成上面 1–2（让 `updates.url`/`projectId` 落进 app.json），**再**跑一次 `build-unsigned-ipa.yml` 出 ipa 并 Sideloadly 装机。这样这枚安装包才内嵌了正确的 OTA 端点与 channel。
- 之后：改 JS → push → `publish-ota-update.yml` 自动发 OTA → 手机重启 App 生效。

## 验证 OTA 生效
1. 装好带 OTA 端点的 App（走一次 build workflow + Sideloadly）。
2. 改一处可见的 JS（如占位屏文案）→ push。
3. 等 `publish-ota-update.yml` 绿 → 手机完全关闭 App 再打开一次（`ON_LOAD` 在启动时拉取，通常需重启第二次看到新内容）→ 文案已变即 OTA 成功。

## 注意
- OTA 只换 JS，**不延长 7 天证书**；App 仍需能启动（靠 SideStore 保活续签）。
- `runtimeVersion` 用 fingerprint：一旦你增删原生模块，指纹变化，旧 build 不会误收新 OTA——此时必须重新出 ipa 装机。
