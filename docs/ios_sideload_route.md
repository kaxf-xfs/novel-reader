# 任务:把自用 Expo iOS App 免费部署到 iPhone(无 Mac、无 $99 开发者账号）

## 背景约束(请严格遵守，不要偏离这个方案去尝试其他路径）

- 项目技术栈：Expo (React Native) + TypeScript，纯自用小说阅读 App，不上架 App Store，不需要给别人测试
- 开发者只有 **Windows 电脑，没有 Mac**
- 不购买 Apple Developer Program（$99/年）
- 目标：证书/签名尽量自动续期，不要求用户每周手动连电脑重装 App
- **明确禁止的路径**（已验证过不可行或不划算，不要建议或尝试）：
  - 不要用 `eas build` 自带的 iOS 凭证自动管理功能配合免费 Apple ID —— 社区反馈这个组合限制多、容易卡在设备注册/证书生成环节，不稳定
  - 不要建议在 Windows 上跑 Hackintosh 或虚拟机装 macOS —— 违反 Apple EULA 且不稳定
  - 不要建议 TrollStore —— 它依赖的 CoreTrust 漏洞已在 iOS 17.0.1 被修复，现代 iPhone 用不了
  - 不要建议购买/租用 Mac 服务作为唯一方案，除非下面的 GitHub Actions 方案verified 失败

## 总体架构

```
本地 Windows 写代码 (Expo + TS)
        │  git push
        ▼
GitHub Actions (macOS runner, 免费)
  expo prebuild → pod install → xcodebuild (不签名)
        │  产出 unsigned.ipa (Artifact)
        ▼
下载到 Windows
        │
        ▼
Sideloadly (Windows 客户端)
  用免费 Apple ID 签名 + 首次安装到 iPhone
        │
        ▼
SideStore (装在 iPhone 上)
  之后每 7 天自动无线续签，无需再碰电脑
```

关键设计原则：**编译**（需要 macOS 工具链）和**签名安装**（不需要 macOS）彻底分离。GitHub Actions 只负责产出一个未签名的 .ipa，签名这一步完全在 Windows 本地用免费 Apple ID 完成，这样不需要在 CI 里存放任何证书密钥（GitHub Secrets 里不用放 Apple 相关的东西）。

---

## Phase 0：前置准备（一次性）

- [ ] 确认 `app.json` / `app.config.ts` 里已经设置了 `ios.bundleIdentifier`（例如 `com.yourname.novelreader`），否则 `expo prebuild` 会报错要求先设置
- [ ] 注册一个**专用的免费 Apple ID**（不要用主 Apple ID）——原因：Sideloadly/SideStore 会反复读写这个账号在 Apple 后台的证书状态，用小号更安全，且免费账号有「每周最多注册约 10 个 App ID、最多 3 个 App 同时安装」的限制，专号更好管理配额
- [ ] 该 Apple ID 建议关闭"双重认证"或生成一个**App 专用密码**（Sideloadly 登录时可能需要）
- [ ] GitHub 仓库准备好，建议设为 **public**（这样 GitHub Actions 的 macOS runner 分钟数完全免费不限量；如果代码需要保密则设 private，注意每月约 2000 分钟的免费额度，macOS 分钟按 10 倍计费，folder个人小项目一般够用）
- [ ] iPhone 上开启 Developer Mode：设置 → 隐私与安全性 → 开发者模式 → 打开（会要求重启）

---

## Phase 1：GitHub Actions 云端编译未签名 .ipa

在仓库根目录创建 `.github/workflows/build-unsigned-ipa.yml`：

```yaml
name: Build Unsigned iOS IPA

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths-ignore:
      - '**.md'

jobs:
  build-unsigned-ipa:
    runs-on: macos-14
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install JS dependencies
        run: npm ci

      - name: Expo prebuild (generate native iOS project)
        run: npx expo prebuild --platform ios --clean --non-interactive

      - name: Install CocoaPods dependencies
        working-directory: ios
        run: pod install --repo-update

      - name: Detect workspace and scheme
        id: detect
        working-directory: ios
        run: |
          WORKSPACE=$(ls -d *.xcworkspace | head -n 1)
          SCHEME=$(xcodebuild -workspace "$WORKSPACE" -list \
            | awk '/Schemes:/{flag=1;next}/^$/{flag=0}flag' \
            | sed 's/^[ \t]*//' | head -n 1)
          echo "workspace=$WORKSPACE" >> $GITHUB_OUTPUT
          echo "scheme=$SCHEME" >> $GITHUB_OUTPUT
          echo "Detected workspace: $WORKSPACE, scheme: $SCHEME"

      - name: Build unsigned .app (no code signing)
        working-directory: ios
        run: |
          xcodebuild clean build \
            -workspace "${{ steps.detect.outputs.workspace }}" \
            -scheme "${{ steps.detect.outputs.scheme }}" \
            -configuration Release \
            -sdk iphoneos \
            -derivedDataPath build \
            CODE_SIGNING_ALLOWED=NO \
            CODE_SIGNING_REQUIRED=NO \
            CODE_SIGN_IDENTITY="" \
            CODE_SIGN_ENTITLEMENTS="" \
            PROVISIONING_PROFILE_SPECIFIER=""

      - name: Package unsigned IPA
        working-directory: ios
        run: |
          APP_PATH=$(find build/Build/Products/Release-iphoneos -maxdepth 1 -name "*.app")
          mkdir -p Payload
          cp -r "$APP_PATH" Payload/
          zip -r unsigned.ipa Payload
          mkdir -p ../output
          mv unsigned.ipa ../output/

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: unsigned-ipa
          path: output/unsigned.ipa
          retention-days: 14
```

**调试提示（给 agent）**：
- 如果 `xcodebuild -list` 检测 scheme 失败，手动跑一次 `xcodebuild -workspace <name>.xcworkspace -list` 看输出，把 scheme 名硬编码进 workflow 也可以
- 如果 `pod install` 报错，检查 `ios/Podfile` 是否因为 `expo prebuild --clean` 被正确重新生成
- 触发方式：先用 `workflow_dispatch`（GitHub 网页上手动点 Run workflow）测试通，跑通后再考虑要不要挂到 push 上自动跑
- 编译产物在 Actions 运行页面的 Artifacts 里下载，是个 zip，解压后是 `unsigned.ipa`

---

## Phase 2：Windows 本地签名并首次安装（Sideloadly）

- [ ] 从官网 https://sideloadly.io/ 下载 Windows 版 Sideloadly 并安装（会要求装 Apple 的 iTunes Web 版驱动组件，按提示装）
- [ ] 手机用数据线连接 Windows 电脑，信任这台电脑
- [ ] 打开 Sideloadly，把 Phase 1 下载的 `unsigned.ipa` 拖进去
- [ ] 填入 Phase 0 注册的免费 Apple ID 邮箱和密码（开了双重认证就用 App 专用密码）
- [ ] 点击 Start，Sideloadly 会自动：向 Apple 申请一个免费的 iOS Development 证书 → 注册 App ID → 生成描述文件 → 签名 → 安装到手机
- [ ] 手机首次打开这个 App 会提示"不受信任的开发者"，去 设置 → 通用 → VPN与设备管理，点击对应的 Apple ID 邮箱，选择"信任"

> ⚠️ 注意：AltServer 官方也有 Windows 版，但目前有不少用户反馈在 Windows 11 上安装报错，稳定性不如 Sideloadly，不推荐作为主力工具。

---

## Phase 3：安装 SideStore，实现自动续签（免去每 7 天手动重装）

免费签名的证书本质上 7 天后失效，SideStore 的作用是让手机自己在后台完成续签，不需要用户再碰电脑。

- [ ] 下载 Jitterbugpair（Windows 64-bit 版）：https://github.com/osy/Jitterbug/releases
- [ ] 手机连接 Windows 电脑（USB），在 Jitterbugpair 所在文件夹按住 Shift 右键选"在此处打开 PowerShell 窗口"，运行 `.\jitterbugpair.exe`，生成一个 `.mobiledevicepairing` 文件
- [ ] 从 SideStore 官方 GitHub Release 下载 `SideStore.ipa`：https://github.com/SideStore/SideStore/releases
- [ ] 用 Sideloadly（同 Phase 2 的方法）把 `SideStore.ipa` 也签名安装到手机上（会占用免费账号 3 个 App 名额中的 1 个）
- [ ] 手机上从 App Store 免费下载 WireGuard App
- [ ] 打开 SideStore App，按提示下载它提供的 WireGuard 配置文件，导入 WireGuard，开启这条 VPN 隧道（之后需要保持常开，SideStore 靠它伪装成"电脑正在连接"来触发续签）
- [ ] 在 SideStore 里导入前面生成的 `.mobiledevicepairing` 文件
- [ ] 完成后，SideStore 会在后台定期检查证书剩余天数，临期前自动无线续签你的阅读 App 和 SideStore 自己

---

## 维护清单（以后要注意的事，写进 README 或告诉用户）

- **更新代码后的正常流程**：改代码 → push → GitHub Actions 自动/手动触发 → 下载新的 unsigned.ipa → Sideloadly 重新签名安装一次。这是正常的版本更新，跟"证书过期"是两回事
- **免费账号配额**：最多同时安装 3 个 App（SideStore 占 1 个，阅读 App 占 1 个，还剩 1 个余量），每 7 天内最多注册约 10 个 App ID
- **如果手机长时间没联网触发后台任务**（比如超过 7 天没开 WireGuard/SideStore），证书会过期，App 打不开。此时打开 SideStore，手动点一次"刷新"（Refresh）即可恢复，App 内数据不会丢失
- **iOS 系统更新后的风险**：SideStore 稳定版有时会因为 iOS 新版本临时失效（报 VPN 连接错误等），需要关注 SideStore 官方文档 https://docs.sidestore.io 或切换到 nightly 开发版
- 未来如果要多做几个自用 App，超过 3 个免费名额，可以研究 **LiveContainer** 项目（能让多个 App 共用 1 个 App ID 名额），但当前只有 1 个阅读 App 不需要

---

## 验收标准

1. GitHub Actions 能稳定跑出 `unsigned.ipa`，无需任何 Apple 相关的 Secrets
2. Sideloadly 能用免费 Apple ID 把这个 ipa 装上 iPhone 并正常打开
3. SideStore + WireGuard 配置完成后，一周后不用碰电脑，App 依然能正常打开（说明自动续签生效）
