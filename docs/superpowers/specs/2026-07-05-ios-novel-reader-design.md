# PRD & 实施规划：个人 iOS 小说阅读器（NovelReader）

## Context（为什么做这个）

用户要为自己做一款 iOS 手机小说阅读 App。核心痛点与诉求：

1. **大文件正确载入**：常读 txt 单本可达 15–20MB+，需秒开、不卡、不 OOM。
2. **章节正确解析**：txt 来源杂（盗版整理版居多），编码混杂、章节格式多样、含脏数据/假章节，必须稳健分章。
3. **进阶排版客制化**：字体、背景色、字号、行距/段距、边距、主题，顶/底显示系统时间与电量。
4. **交互习惯**：竖屏、上下滑动连续阅读。
5. **UI 要求高**：简洁、美观、高级、modern。

约束：用户在 **Windows 11，无 Mac**；**自用、不愿为上机付费**（拒绝 $99/年 Apple 开发者账号）。

预期结果：一个能把本地大 txt 导入书架、正确分章、竖向连续滑动阅读、排版高度可定制的精致 iOS App，且能在 Windows 环境下持续迭代。

---

## 关键决策（已与用户确认）

| 项 | 决策 |
|---|---|
| 技术栈 | **Expo (React Native) + TypeScript**，EAS 云构建（无需 Mac） |
| 装机 | **GitHub Actions（macOS runner）出未签名 .ipa → Sideloadly（免费 Apple ID 签名）→ SideStore 自动续签**（准绳见 `docs/ios_sideload_route.md`）。禁用 eas build 免费凭证管理 / AltServer / TrollStore |
| 文件来源 | 从 **iOS 文件App / iCloud 导入**到 App 内书架（多本管理） |
| 章节解析 | 标准 `第X章/回/卷/集/节/话` 正则为主 + 层级（卷/集→章）+ 楔子/序/番外/特典/后记 + 脏数据/假章节过滤 + 兜底与手动可调 |
| 阅读方向 | 竖屏、上下连续滑动 |
| 字体集 | 仓耳今楷 CangEr JinKai04（默认正文，取自 ai-writer 的 19MB TTF）、思源黑体 Noto Sans SC、iOS 系统宋体/黑体（报宋/苹方）、开源书籍体 **霞鹜文楷 LXGW WenKai** + **思源宋体 Noto Serif SC** |

---

## 开发工作流（TDD + subagent，worker/reviewer 均 sonnet）

**总原则：task 串行，未通过 verify 不得进入下一个 task。**

每个 task 内部循环：
1. **worker（sonnet）**：先写失败测试（RED）→ 最小实现使其通过（GREEN）→ 重构（REFACTOR）。遵循 `test-driven-development` skill。
2. 运行该 task 的**自动化测试** + **verify 标准**。
3. **reviewer（sonnet）**：独立审阅代码——边界条件、错误处理、是否符合本规范、可读性/隔离性。遵循 `requesting-code-review` / `receiving-code-review` skill。
4. worker 按 review 修复，直至 **reviewer 通过 且 verify 全绿**。
5. 标记 task 完成，进入下一 task。

**两类 verify：**
- **自动 verify**：逻辑模块（编码探测、章节解析、索引、store）用 Jest 单测严格断言，用 9 本真实样本作 fixture。CI/本地可跑，无需真机。
- **手动 verify（用户真机确认）**：装机链路、滚动帧率、跨章续滚、排版视觉、时钟/电量——用户在 Windows 无本地真机测试链路，这类由用户在真机上确认后我方才推进。

落地时以 `subagent-driven-development` 驱动 worker，`requesting-code-review` 驱动 reviewer，两者 model 均指定 sonnet。

---

## 真实测试集勘察结论（reference/example_novels，9 本 0.7–15MB）

**编码混杂（必须自动探测+转码，不能只看 BOM）**
- UTF-8：昊天传、风月大陆、如影逐形
- UTF-8 BOM：春秋风华录
- **GBK / GB18030**：凡人修仙传、魔天记、晚明、无职转生、龙魂侠影
- 混排 CRLF / NEL 行结束符、超长行、行首缩进

**章节格式多样**
- `第一章 荒唐梦境`（中文数字）/`第476章 何以止战？`/`第1章`（阿拉伯数字，同书混用）
- 两级层级：`第一卷 七玄门风云` → `第一章 …`（凡人、晚明、龙魂）；`第一集 天风之战 第二章 …`（风月，卷章同行）
- `楔子 / 序 / 番外 / 特典 / 后记`、`第一回：书院春意`（全角冒号）
- 章名带 `（上/中/下）`；也有 `第一章` 无标题（魔天记）

**脏数据 / 假章节（必须排除）**
- 叙事文字被误判：`第二年`、`第五层？`、`第三遍…`、`第二处…`、`第二天中午时分…`
- 排除靠启发式：**行首 + 分隔字必须属于 {章回卷集节话部篇} + 整行足够短(≤ ~30 全角字) + 不含长句标点串**；盗版广告行（`本书由…整理`、`更多请访问 www…`）按可配置模式清洗；替换字符 `�` 容错

---

## 架构设计

### 技术栈与关键依赖
- Expo SDK（最新）+ Expo Router + TypeScript
- `expo-document-picker` + `expo-file-system`：从文件App/iCloud 导入，复制进沙盒 `documentDirectory`
- `expo-font`：打包并注册自定义字体（仓耳今楷、霞鹜文楷、思源宋/黑）
- `expo-battery` + JS `Date`：电量与系统时间
- `expo-sqlite`：书架元数据、章节索引（offset）、阅读进度
- `react-native-mmkv`（或 AsyncStorage）：全局排版设置
- 列表虚拟化：`@shopify/flash-list`
- 编码探测：`jschardet`（chardet 端口，判定置信度）；解码：`iconv-lite` + `buffer`（RN 可用）——**列为 T1 验证项**

### 大文件策略（>20MB 的核心）
**绝不把整本解码后的字符串放进 React state。**
1. **导入时（一次性）**：分块流式读取 → 探测编码 → 转码为 UTF-8 → 写一份规范化副本到沙盒 → 构建章节索引（title, level, charOffset/byteOffset）持久化到 SQLite。全程带进度条，重活分块 yield 避免卡 UI 线程。
2. **阅读时（按需）**：用 `expo-file-system` 按 position/length 只切出「当前章 + 邻近若干章」的窗口载入内存，滚动时滑窗加载/释放；长章内再按段落分块渲染。
3. **编码探测顺序**：BOM → UTF-8 合法性校验 → 否则按 GB18030 解码（可选 Big5 兜底）。

### 章节解析模块（独立、可测试）
- 输入：规范化 UTF-8 文本（或分块流）；输出：`Chapter[] { title, level, startOffset, endOffset }`
- 带优先级的正则规则集 + 层级（卷/集 vs 章）+ 校验启发式（行长、行首、标点）
- 清洗：去广告/spam 行、trim、规范空白与空行、丢弃替换字符
- 兜底：识别到章节数 < 阈值时，提供「按固定大小切分」或「手动标记」，并允许**按本覆盖解析规则**
- **单元测试用 9 本真实样本作 fixture**（关键质量保障）

### 数据模型
- `Book { id, title, author?, normalizedPath, encodingOrig, sizeBytes, importedAt, coverColor, ruleId }`
- `Chapter { bookId, index, title, level, startOffset, endOffset }`
- `Progress { bookId, chapterIndex, charOffset, updatedAt }`
- `Settings（全局）{ fontFamily, fontSize, lineHeight, paragraphSpacing, margin, theme, textColor, showClock, showBattery, brightness }`

### UI / UX（简洁·现代·高级）
- **书架**：网格/列表，自动生成封面（书名+主题色）、阅读进度、上次阅读；导入按钮
- **阅读页**：全屏竖向连续滑动；点击中部切换顶/底栏
  - 顶栏：返回、章节名、系统时间 + 电量
  - 底栏：进度%、上下章、目录、排版齿轮
  - 跨章无缝续滚
- **排版抽屉**：字体（仓耳今楷/霞鹜文楷/思源宋/思源黑/系统苹方·报宋）、字号、行距、段距、边距、主题预设（纸黄/护眼绿/夜间黑/纯白/暗色）、亮度、字色、时钟/电量开关
- **目录**：跳转 + 搜索
- 设计语言：精致排版、留白充足、克制动效、SF 图标、明暗双主题；配色参考 ai-writer 的 slate/indigo 高级灰

---

## 串行 Task 清单（每个 task 必须 verify 通过才进入下一个）

> 逻辑先行、UI 后建：先把最难的编码/解析/大文件做成有测试保障的纯模块，再搭 UI。装机链路（T0）最先打通以暴露"无 Mac/无付费"的最大风险。

**T0 — 脚手架 + 装机链路 spike**
- 内容：Init Expo+TS 项目于 `D:\Games\novel-reader`；配置 EAS；云构建 .ipa；AltStore 免费签名装真机；启动占位屏。
- reviewer 关注：项目结构、EAS/签名配置解耦（易切 TestFlight）。
- **手动 verify**：真机冷启动显示占位屏。⚠️ 若签名链路不通，回退 Sideloadly 或如实告知需付费。

**T1 — 编码探测与转码模块（纯逻辑 · TDD）**
- 内容：`detectEncoding()` + `decodeToUtf8()`，支持 UTF-8 / UTF-8-BOM / GB18030（可选 Big5）。
- 测试：9 样本前 N KB 探测编码断言；已知 GBK 字节串解码正确；转码后中文快照无乱码。
- **自动 verify**：单测全绿；5 本 GBK/UTF-8 样本转码快照通过。

**T2 — 章节解析模块（纯逻辑 · TDD · 核心）**
- 内容：规则集 + 层级(卷/集→章) + 启发式过滤(行首/短行/无长句标点) + 广告行清洗 + 兜底。
- 测试：每本样本期望章节数区间、首/末章标题、假章节(`第二年/第三遍/第五层`)不计入、卷章层级正确。
- **自动 verify**：9 样本单测全绿。

**T3 — 大文件导入管线 + 章节索引持久化（file-system + sqlite）**
- 内容：分块流式读取→转码→建索引→存 SQLite；按 offset 切片还原章节。
- 测试：15MB 文件建索引；断言分块 API 调用（非整本驻留）；offset 切片文本正确。
- **自动 verify**：单测全绿；**手动 verify**：真机导入凡人 15MB 计时可接受、无 OOM。

**T4 — 阅读页竖向连续滑动 + 滑窗加载 + 进度保存/恢复**
- 内容：FlashList 竖向连续滚动、当前±邻近章滑窗加载/释放、进度存取恢复。
- 测试：滑窗加载/释放逻辑、进度 store 单测。
- **自动 verify**：单测全绿；**手动 verify**：真机滚动帧率、跨章无缝、杀进程后恢复原位。

**T5 — 排版设置（字体集/字号/行距/段距/边距/主题 · 即时生效 + 持久化）**
- 内容：settings store + 样式计算函数；字体集（仓耳今楷默认/霞鹜文楷/思源宋/思源黑/系统苹方·报宋）；主题预设。
- 测试：store 存取、样式计算、字体注册。
- **自动 verify**：单测全绿；**手动 verify**：真机逐项切换即时生效并持久化。

**T6 — 书架（多本导入/管理/自动封面/进度）**
- 测试：book CRUD、封面色生成。
- **自动 verify**：单测全绿；**手动 verify**：真机多本导入/切换/删除。

**T7 — 顶/底栏（系统时间/电量/进度%/目录/点击切换）+ 目录搜索**
- 测试：时间/电量格式化、目录搜索过滤。
- **自动 verify**：单测全绿；**手动 verify**：真机点击切换、时钟电量实时更新。

**T8 — 打磨（P2）**
- 动效、亮度、明暗主题细化、备份/导出、EAS Update OTA 迭代流。

---

## 验证方式（端到端）
- **解析正确性**：对 9 本样本跑解析单测，人工核对章节数与前后若干章标题（覆盖 GBK/UTF-8/BOM、卷章层级、楔子/番外、假章节排除）
- **大文件性能**：在真机（或 Expo Go/dev build）导入 15MB 凡人修仙传，测导入耗时、滚动帧率、内存占用
- **装机链路**：EAS 构建 → AltStore 装机 → 冷启动 → 导入 → 阅读全流程走通
- **排版**：逐项切换字体/字号/行距/主题，确认即时生效并持久化；时钟电量实时更新

---

## 待办 / 技术风险
- ⚠️ **无 Mac + 无付费账号装机链路**：GitHub Actions 出未签名 .ipa → Sideloadly 签名 → SideStore 续签（准绳 `docs/ios_sideload_route.md`）。CI workflow 已建；待用户 push 到 GitHub 后真机验证 T0 占位屏
- ⚠️ RN 侧 GBK 解码库可用性（iconv-lite/buffer polyfill）
- ⚠️ 15–20MB 解析在真机的耗时（分块 + 进度条兜底）
- ℹ️ 开源字体商用授权确认（LXGW WenKai SIL OFL ✓、Noto 系 OFL ✓、仓耳今楷需确认 ai-writer 现有授权范围）
- ℹ️ 后续如切 TestFlight：仅换 EAS build profile + 提交，无功能改动
