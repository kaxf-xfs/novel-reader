# 增量 8 · 已读图鉴（人物图鉴 + 世界观词典 + 关系图）— 设计 Spec

> 经四轮 opus 对抗式审阅定稿（v4）。审阅重点始终是**零剧透泄漏**：缓存的结构化图鉴在读者**回退阅读进度**后必须自动收窄，绝不展示任何 idx > cutoff 的内容。

## Context

AI 地基（增量 7：v2 富摘要 + autoSummarize 开关 + `ai_summaries` 缓存 + 查询感知检索）就绪后，把「已读内容」组织成一个可浏览、防剧透的图鉴：人物卡片、世界观词典、关系图。这是继增量 5–7（问书/回顾/人物/自动摘要）之后的下一个 AI 功能，也是本项目**第一个原生依赖**（`react-native-svg`，用于关系图渲染）。

用户已在设计对话中拍板：
- 人物图鉴 + 世界观词典 + 关系图 **一个增量一起做**（接受一次原生重装的代价，不分期）。
- 关系图交互方式：**按势力分组布局**（而非力导向随机布局或纯列表）。
- 成本模型：**跟随全局 `autoSummarize` 开关**——开启时图鉴自动覆盖全部已读章节；关闭时图鉴基于已缓存的摘要生成，并显示「补全到当前进度」按钮供用户手动触发。
- **质量优先**：这是贯穿本设计全程的标准指令——遇到「省成本 vs 保信息量」的取舍，默认选保信息量（本设计的抽取输入从"弧摘要"改回"章摘要"就是该指令否决了一版更省钱但会丢身世/伏笔细节的方案）。

## 全局约束

- **首个原生依赖，本增量不走 OTA**：`npx expo install react-native-svg`（锁定 SDK57 兼容版本）。实现完成后必须触发 `build-unsigned-ipa.yml` 重新出未签名 ipa，用户用 Sideloadly 重新装机（参见 `docs/ios_sideload_route.md`）才能在真机验证。Jest 的 `transformIgnorePatterns` 已预先白名单 `react-native-svg`，无需额外配置。
- **防剧透硬不变量**（贯穿全设计的红线）：图鉴任何展示内容只能覆盖 `idx <= cutoff`（`cutoff = 当前章 - 1`）；抽取阶段只读取 `≤cutoff` 的已缓存章摘要，绝不触碰未读章节的正文或摘要。
- 复用现有基础设施：`ai_summaries` 表（v2 章/弧摘要）、`chatComplete`（`src/lib/ai/client.ts`）、`ensureSummaries(upgradeStale=false)`（`src/lib/ai/summarize.ts`）、SQLite 加表范式（`sqliteRepository.ts` 的 `CREATE TABLE IF NOT EXISTS` 加法式迁移 + FK CASCADE）、`ReaderScreen` 的 chrome/Modal 注入回调范式（参照 `AiPanel`）、`autoSummarize` 开关语义（`AiConfig`）。

## 防剧透设计（本 spec 的核心，四轮审阅收敛而来）

这是整个设计中审阅耗时最长、也是最容易留漏洞的部分。四轮审阅依次发现并封堵了以下泄漏向量，**全部结论已固化进下面的数据模型**：

1. **第一轮**：原始方案没有为图鉴条目标注 idx，导致读者回退进度后，缓存的图鉴仍完整展示——**修复**：给每个可展示的人物/词条加 `firstChapterIdx`，事件/关系加 `idx`，并引入统一的展示期过滤函数。
2. **第二轮**：`aliases`（别名/真名）、`groups`（势力归属）、`origin`（身世线索）、`identity`（身份描述）这些**会随剧情演进而增补的标量字段**仍然是裸字符串，没有跟着过滤——即使人物本身的 `firstChapterIdx` 早已 `≤cutoff`，其后续揭示的真实身份、势力归属依然会在回退后泄漏。**修复**：这些字段全部改为 `{text, idx}[]` 数组，各自独立按 idx 过滤。
3. **第三轮·质量取舍纠偏**：为了压低抽取成本，曾提议把输入从「章摘要」换成「弧摘要」（25 章合一，调用数从 ~130 降到 ~8）。但弧摘要是高层情节梗概，恰恰会压掉章摘要 v2 专门保留的身世/伏笔细节，与"质量优先"标准指令直接冲突。**修复**：抽取输入改回**章摘要**，成本用增量抽取（只抽新增块）+ `autoOn` 后台预热 + 有界并发摊平。
4. **第三轮·信任边界**：所有 idx 如果来自 LLM 自报，LLM 就可能（无论是幻觉还是误解 prompt）标注一个错误或超前的 idx，直接击穿防剧透过滤——这是本设计中**唯一被标记为"严重"的红线项**。**修复**：所有 idx **必须由代码盖章**，取值恒等于该实体所在抽取块的 `maxIdx`（块内所有输入章摘要均 `≤cutoff`，故盖章值恒安全，代价是最多滞后一个块大小，即约 15 章）；LLM 若在输出 JSON 里带了自己的 idx 字段，直接忽略。
5. **第三轮收尾**：即使数组字段都带了 idx，仍有两个裸标量未覆盖——(A) `Character.name`（人物的"当前显示名"）——如果后续块把人物的真实姓名当作新数据覆盖了 `name` 字段，回退后依然会看到未来揭示的真名；(B) `Term.def`（世界观词条释义）——同样可能被后续更详细/更剧透的释义覆盖。**修复**：`name` 定义为"**最早出现该人物的块（min firstChapterIdx）里的字面名**，一旦写定永不被后续块覆盖"，更晚出现的名字一律进 `aliases`（带揭示 idx）；`Term.def` 同样改为 `{text, idx}[]` 版本化数组，展示时取 `≤cutoff` 的最新一条。
6. **第四轮（收尾）**：`mergeCodex` 的合并输入 `partials` 来自 `runPool` 并发抽取，产出顺序天然无序（不等于章节顺序）。如果"canonical name 取最早块、永不覆盖"这条规则是按**折叠顺序**（即 `partials` 数组顺序）执行"first-write-wins"，而不是按**章节顺序**，那么在并发场景下，一个后来章节的块完全可能先被折叠、把"未来真名"错误地固化成 canonical name——这就绕过了第 5 点刚封死的洞。**修复**：`mergeCodex` 在折叠前必须先把 `partials` 按块 `maxIdx` **升序排序**，让"first-write-wins"等价于"最早块优先"。

## 数据模型

新表 `ai_codex(bookId PK, coveredUptoIdx, model, promptVersion, json, updatedAt)`——每本书一行，`json` 字段存序列化后的结构化图鉴。加法式 DDL（`CREATE TABLE IF NOT EXISTS`），外键 `bookId` 级联删除（删书自动清图鉴）。仓储层新增 `getCodex(bookId)` / `putCodex(record)`，InMemory 与 Sqlite 双实现（InMemory 需手动实现级联清理）。

### TypeScript 类型

```ts
interface Codex {
  characters: Character[];
  terms: Term[];
  relations: Relation[];
}

interface Character {
  /** canonical 显示名：取最早出现该人物的块（min firstChapterIdx）的字面名，永不被后续块覆盖。 */
  name: string;
  /** 后续所有别名/真名，各自带揭示所在块的 idx。 */
  aliases: { text: string; idx: number }[];
  /** 身份描述，随剧情增补，各条带 idx。 */
  identity: { text: string; idx: number }[];
  /** 身世/来历线索，可选，各条带 idx。 */
  origin?: { text: string; idx: number }[];
  /** 势力/门派归属，随剧情变化，各条带 idx。 */
  groups: { name: string; idx: number }[];
  /** 该人物首次出现的章节 idx（人物本身是否展示的门槛）。 */
  firstChapterIdx: number;
  /** 关键事件，可选，各条带 idx。 */
  events?: { text: string; idx: number }[];
}

interface Term {
  name: string;
  category: '境界' | '势力' | '功法' | '地理' | '物品' | '其它';
  /** 释义版本化数组；展示取 idx<=cutoff 中的最新一条。 */
  def: { text: string; idx: number }[];
  firstChapterIdx: number;
}

interface Relation {
  /** 存 canonical name（Character.name），非原始字符串。 */
  from: string;
  to: string;
  kind: string; // 师徒/同门/亲缘/结盟/结怨/主仆…
  /** 该关系被披露所在块的 idx。 */
  idx: number;
}
```

### idx 盖章规则（红线，代码强制，不可由 LLM 覆盖）

抽取以「块」为单位（每块约 15 条章摘要，全部 `≤cutoff`）。**块内所有实体的 idx，一律由调用方代码设为该块的 `maxIdx`**（块内最大章节 idx），与 LLM 输出内容无关；如果 LLM 在 JSON 里自带了 idx 字段，解析时直接丢弃、不采信。这保证了：即使 LLM 幻觉出一个错误的 idx，展示层看到的 idx 也恒等于"该块必然已读完"这一安全值，回退防护不依赖 LLM 输出的可信度。

### 展示门：`codexForCutoff(codex, cutoff): Codex`

这是**唯一**允许把裸 `Codex`（可能含未来数据）转换为可展示数据的纯函数，也是本设计防剧透闭环的最后一道也是唯一一道闸门：

- 人物：仅保留 `firstChapterIdx <= cutoff` 的人物。
- 保留人物的 `name` 直接显示（因为其来源块恒 `≤cutoff`，天然安全，不需要再过滤）。
- `aliases` / `identity` / `origin` / `groups` / `events` 各自按自身数组元素的 `idx <= cutoff` 独立过滤；若某数组全部被滤掉，字段展示为空（不回退到别的字段，`aliases` 全滤空就是没有已知别名，不是回退到 name 之外的东西）。
- 词条：仅保留 `firstChapterIdx <= cutoff` 的词条；`def` 取过滤后剩余条目中 idx 最大（最新）的一条作为当前释义。
- 关系：仅保留 `idx <= cutoff` 的关系，且**两端点的 name 必须都在本次已过滤保留的人物集合里**（按 canonical name 精确匹配，不经由 aliases 反查）——任一端点缺失则整条关系丢弃。

**纪律**：`ReaderScreen` 是唯一调用 `codexForCutoff` 的地方，在 Modal 打开边界处过滤一次；`CodexModal` 及其所有子组件（人物卡、词典列表、关系图）只接收过滤后的结果，永远不持有裸 `codex` + `cutoff` 这两个原料一起传下去——避免将来任何新增 UI 路径不小心绕过这道闸门直接读取原始数据。

## 抽取（map-reduce over 章摘要）

### `chatComplete` 的加法式扩展

`chatComplete`（`src/lib/ai/client.ts`）新增可选参数 `responseFormat?: 'json_object'`，透传为请求体的 `response_format` 字段。**best-effort**：不同 endpoint 支持程度不同（例如 DeepSeek 要求 prompt 正文里必须出现"json"字样才会生效），不支持时不报错、静默退化为普通文本输出，由后续的健壮 JSON 解析兜底。

抽取调用固定使用：JSON mode（若 endpoint 支持）+ 低温度（0.2，降低幻觉/格式漂移）+ 显式传入足够大的 `maxTokens`（截断的主因是 token 预算不够，而非缺少重试机制，所以两者都要有）。

### `extractCodex`

```ts
function extractCodex(
  deps: { chat: SummarizeFn },
  params: {
    blocks: { maxIdx: number; summaries: string[] }[]; // 每块 ~15 条章摘要，全部 idx<=cutoff
    roster: { name: string; aliases: string[] }[]; // 已知名册，用于跨块锚定
    model: string;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<Partial<Codex>[]>; // 每块产出一份 partial，由 mergeCodex 归并
```

- **输入选择**：章摘要（v2，~450 字/章），而非弧摘要（~400 字/25 章）。理由见上文"质量取舍纠偏"。每块约 15 条章摘要打包为一次 LLM 调用；对一部 2000 章的小说，约产生 130 次调用——DeepSeek 定价下金额可忽略，时间成本通过增量抽取（只抽新块）+ `autoOn` 后台预热 + 有界并发摊平，用户不会一次性等待全部完成。
- **idx 盖章**：块内所有实体的 idx（人物 `firstChapterIdx`/数组元素 idx、词条 idx、关系 idx）一律由调用方代码设为该块的 `maxIdx`，LLM 自报的 idx 字段丢弃不采信（见上文红线）。
- **锚定式增量**：每次调用向 prompt 注入 `roster`（已归并出的人物名+别名列表，按已知关系度/出现频次排序，超出长度上限只保留 name），要求 LLM 将新信息对齐到已知人物或明确声明为新增人物，别名需归并到已知条目；关系的两端点必须是名册中已确认或本块内明确新增的人物，否则该条关系丢弃（配 1-2 个别名归并的 few-shot 示例压低幻觉关系率）。
- **健壮 JSON 解析**：从返回文本中提取 \`\`\`json 代码块（或整体尝试解析），`JSON.parse` 包在 try/catch 中；解析成功后逐实体做 schema 校验（缺 `name` 等必填字段的实体直接跳过），单个坏实体不影响其余实体入库，绝不因为一条脏数据整块作废。
- **截断处理**：`finishReason === 'length'` 时，将该块的摘要集合二分为两个子块（各自重新计算自己的 `maxIdx`）分别重新抽取；递归需要一个基例（单条摘要仍然截断 → 直接提高 `maxTokens` 重试一次，或接受已成功解析出的部分实体）和一个递归深度上限（防止异常输入导致无限二分）。

### `mergeCodex`

```ts
function mergeCodex(existing: Codex, partials: Partial<Codex>[]): Codex;
```

纯确定性合并（不引入 LLM 归并 pass——见下方"LLM 归并降级为 YAGNI"）：

1. **`partials` 折叠前必须先按块 `maxIdx` 升序排序**（红线守卫，因为 `runPool` 并发产出的顺序与章节顺序无关；这是保证下面第 2 点"canonical name 永不覆盖"规则真正生效的前提）。
2. 按 name / aliases（大小写和空白归一化后）把新条目归并到已存在的 canonical 人物；确定该人物时优先精确匹配已有 `name`，其次匹配已有 `aliases` 里的任意 `text`。
3. **canonical `name` 取 min `firstChapterIdx` 那个块贡献的字面名，一旦写定永不被后续折叠覆盖**；后续块提供的、与当前 `name` 不同的名字，一律作为新的 `aliases` 条目追加（带其所在块的 idx）。
4. `identity` / `origin` / `groups` / `aliases` / `events` / `def`：按 `(text, idx)` 或 `(name, idx)` 组合去重后 **append-distinct**（不做覆盖式塌缩），人物/词条的 `firstChapterIdx` 取所有贡献块中的最小值。
5. `Term.category`：**first-write-wins**（第一次出现时定的分类不被后续块覆盖，避免后续块把分类改判为剧透性更强的类别）。
6. `Relation` 去重 key 必须包含 `kind`（即 `from+to+kind` 才算同一条关系）——否则「先结盟、后结怨」这种同一对人物先后产生不同性质关系的情况，后一条会静默覆盖前一条，丢失前一条关系及其 idx。
7. 关系端点在归并后统一解析为对应人物当前的 canonical `name`。

**碎片化/重复人物列为真机验收项**（同一人物因为别名归并失败被拆成两条记录）；只有在真机验证中观测到明显的碎片化问题，才追加一个基于 LLM 的归并 pass 作为后续增量——当前设计明确不预先构建这个能力（YAGNI）。

### `ensureCodex`

```ts
function ensureCodex(
  deps: { chat: SummarizeFn; fs: FileGateway; repo: BookRepository },
  params: {
    book: BookRecord;
    chapters: ChapterRecord[];
    cutoff: number;
    model: string;
    autoOn: boolean;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<{ codex: Codex; coveredUptoIdx: number; complete: boolean }>;
```

- **模块级 per-book 异步锁**（不是 hook 局部 ref——必须在模块作用域，跨组件重挂载/后台任务也要生效）：串行化 `ai_codex` 单行 blob 的读-改-写，防止"补全"按钮点击与任何后台预热任务并发导致丢更新。
- **版本容忍**：`model` 或 `promptVersion` 与已存储值不一致时，**不自动触发全书重建**——旧图鉴照常展示，新的抽取只增量扩展 `coveredUptoIdx` 之后的部分（schema 只做加法式演进，读路径的新增字段全部可选）。全量重建只能通过 UI 上的显式「重建图鉴」按钮触发。
- **可恢复检查点**：每处理 N 个块（N 待实现时定，建议 5–10）就在锁内 `putCodex` 落库一次并推进 `coveredUptoIdx`，取消或中断后重新触发不需要从头开始。
- **`autoOn === true`**：先调用 `ensureSummaries(cutoff, upgradeStale=false)` 保底章摘要缓存完整，再增量抽取 `[coveredUptoIdx+1 .. cutoff]` 对应的章摘要块、归并落库，`complete` 恒为 `true`（首次开启是一次性有界任务，带进度和取消，复用 `runPool` 并发；一部 2000 章小说约 2–3 分钟）。
- **`autoOn === false`**：只使用**当前已缓存**（不要求连续、允许有缺口）的 `≤cutoff` 章摘要打块抽取；`coveredUptoIdx` = 已纳入抽取的最大 idx；`complete` = "`≤cutoff` 范围内没有缺失的章摘要"。若不完整，UI 显示「补全到当前进度」按钮，点击后触发"保底 + 抽取"（进度/取消复用 `AiPanel` 已有范式）。

## 势力分组布局（纯函数，可单测）

```ts
function layoutFactionGraph(
  characters: Character[],
  relations: Relation[],
  opts: { width: number; height: number; maxNodes?: number }
): {
  nodes: { name: string; x: number; y: number; group: string }[];
  edges: { from: string; to: string; kind: string; x1: number; y1: number; x2: number; y2: number }[];
};
```

- **输入必须是 `codexForCutoff(codex, cutoff)` 的输出**——绝不允许把未过滤的原始 codex 传入布局函数，否则未来关系/人物会通过"哪些节点入选画布""节点的可见 degree"这类侧信道间接泄漏，即使画布本身没有直接渲染未来文本。
- **大 cast 裁剪**：只绘制 top-N（默认 30）节点，排序依据是**可见关系数**（即输入的 `relations` 里该节点出现的次数，而非潜在的全量关系）；完整花名册始终在人物 tab 的列表里可查，不受此裁剪影响。
- **分组聚类**：各 `group` 的质心沿一个大圆均匀分布，组内成员在质心周围的小圆上环绕排列。
- **退化路径**（必须处理，否则真实数据分布会让布局失效）：
  - 绝大多数人物没有 `groups` 或分组信息占比过低 → 退化为单一大圆按可见 degree 排布，不做分组。
  - 分组数超过 6 个 → 只保留 top-K（按组内人数）大组，其余全部归并进一个"散"组。
  - 单个人物没有任何 `groups` → 归入"散"组。
- 纯几何计算，无外部依赖，确定性（同输入必产生同输出坐标），可针对边坐标、节点裁剪、退化路径分别写单测。不引入任何布局算法库。

## UI

### `CodexModal`

阅读页内的**全屏 Modal**（模式与 `AiPanel` 一致：Modal 覆盖但保持 `ReaderScreen` 挂载和阅读位置不丢失；打开前做与 `AiPanel` 相同的门控——`aiConfig.enabled && apiKey && consentAt`）。

**纪律（零泄漏，重申）**：`ReaderScreen` 在打开 Modal 的边界处调用一次 `codexForCutoff(codex, cutoff)`，`CodexModal` 自身及其内部所有子组件**只接收过滤后的 `Codex`，永不持有原始 `codex` 对象与 `cutoff` 两者同时存在的引用**。这条纪律的目的是杜绝将来某个新增的 UI 路径（例如搜索框、导出功能）不经意地直接访问 `codex.characters` 之类的原始字段绕过这道门。

三个 tab：

- **人物**：花名册列表（按 `firstChapterIdx` 排序）→ 点击展开人物卡（身份、身世、首次登场章节、关键事件、关系列表）。人物卡用 `CodexModal` 内部的 `selectedCharacter` state 实现，**不嵌套 Modal**（与增量 5 遗留的"避免嵌套 Modal"规范一致）。
- **世界观**：按 `category` 分组展示的词条列表。
- **关系图**：`RelationshipGraph` 组件——见下。

四态：正常展示已缓存图鉴；`complete === false` 时展示「补全到当前进度（第 N 章）」按钮（点击触发有界抽取，带进度和取消）；「重建图鉴」按钮（仅在检测到 model/promptVersion 变更时展示）；loading / error 态；未配置 AI 或未同意隐私条款时展示与 `AiPanel` 一致的门控提示。

### `RelationshipGraph`

`react-native-svg` 组件：`Circle` 渲染人物节点，`Line` 渲染关系边，`Text` 渲染标签；坐标数据完全来自 `layoutFactionGraph` 的纯函数输出。

- 点击节点：切换到「人物」tab 并将该人物设为 `selectedCharacter`（纯 tab 内导航，不产生嵌套 Modal）。
- 拖动手势用 `PanResponder` 实现，**只更新外层 `<G transform>` 的平移量，不对每个节点单独 `setState`**（避免大 cast 场景下拖动引发的逐节点重渲染性能问题）。
- 本增量只做拖动平移，不做缩放（明确列入"不做"）。

### 入口

`ReaderScreen` 底部工具栏新增「图鉴」`BarButton` → `setShowCodex(true)`；门控同 `AiPanel`：`aiConfig.enabled && apiKey && consentAt`。

## 任务分解概览（详细步骤见后续 TDD 计划）

1. 引入 `react-native-svg` 依赖 + 冒烟测试（确认 jest transform 配置生效）
2. `chatComplete` 加 `responseFormat` 透传（best-effort JSON mode）
3. Codex 类型定义 + `codexForCutoff` 纯过滤函数 + `ai_codex` 表 + repo `getCodex`/`putCodex`（双实现 + 级联删除）
4a. `extractCodex` 单块抽取（锚定名册 prompt、健壮 JSON 解析、idx 代码盖章、截断二分重试）
4b. `mergeCodex` 确定性合并（排序折叠、canonical name 规则、去重追加）
5. `ensureCodex` 编排（模块级锁、检查点、版本容忍、autoOn 两种模式）
6. `layoutFactionGraph`（纯函数、top-N 裁剪、分组、退化路径）
7. `CodexModal` 人物 tab + 人物卡 + 世界观 tab
8. `RelationshipGraph` svg 组件
9. `ReaderScreen` 接线（入口按钮、门控、传 cutoff）→ 门禁 + 原生重出 ipa + Sideloadly 重装 + 真机验证

## Verify

**自动化**：`chatComplete` 的 `responseFormat` 透传；`codexForCutoff`（回退收窄、`firstChapterIdx > cutoff` 人物隐藏、事件/关系按 idx 过滤、关系端点必须在已展示人物集合内）；`ai_codex` 双实现 + 级联删除；`extractCodex`（合并/别名归并/坏 JSON 单条跳过不影响其余/截断二分重试/抽取输入的 idx 全部 `⊆ [0, cutoff]`）；`mergeCodex`（排序折叠、canonical name 永不覆盖、去重追加、`Term.category` first-write-wins、`Relation` dedup 含 kind）；`ensureCodex`（版本容忍不重建、单飞锁、`autoOn=true` 抽到 cutoff 且 complete、`autoOn=false` 只用已缓存 + 补全标志）；`layoutFactionGraph`（确定性、top-N by 可见 degree、分组聚类、三种退化路径、边坐标计算）；`CodexModal` / 人物卡 / 词典列表 / `RelationshipGraph` 的组件态测试（含点击节点切 tab 选中）。全部通过：`npm test` 全绿、`tsc` 干净、`expo export ios` 成功、0 act 警告。

**真机（本增量因含原生依赖，必须真机验证）**：`build-unsigned-ipa.yml` 重新出未签名 ipa → Sideloadly 重装 →
1. 图鉴三个 tab 均可正常打开和浏览；
2. 关系图按势力分组正确渲染、点击节点能跳转到对应人物卡、画布可拖动；
3. `autoSummarize` 开启时图鉴覆盖全部已读内容，关闭时「补全到当前进度」按钮可用且行为符合预期；
4. 删除书籍后对应的 `ai_codex` 记录被级联清除；
5. **防剧透终极验证**：图鉴和人物卡中不出现任何未读内容涉及的人物/设定，且**手动把阅读进度回退到更早的章节后，图鉴内容自动收窄**（不需要手动刷新或重建）；
6. 切换 AI 模型后，旧图鉴内容仍正常展示（不触发自动重建），只有点击「重建图鉴」按钮才会全量重抽。

## 明确不做（本增量范围外）

向量检索；跨书图鉴；关系图缩放（本增量只做拖动平移）；时间轴动画；世界观词条的深度考据/交叉引用；把图鉴功能整合进书架页面。二创功能与角色对话（AI 创作坊）留给增量 9。

## 执行方式

本 spec 批准后：`writing-plans` 技能产出逐步 TDD 计划 → `subagent-driven-development` 技能执行（worker 与 task-reviewer 均使用 sonnet，最终整支分支的 whole-branch review 使用 opus）→ 完成后触发 `build-unsigned-ipa.yml` 重新出未签名 ipa，用户通过 Sideloadly 重新装机（本增量因含原生依赖，不走 EAS Update OTA 路径）。
