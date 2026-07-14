# 增量 8.5 · 已读图鉴 深度优化 — 设计

> 增量 8（人物图鉴+世界观词典+关系图基础版）已完成、通过真机验证并可正常使用。本增量是对该功能的**深度重做**：内容质量差（碎片化堆砌）、关系图拥挤混乱、UI 原始且无法检索——三个方向均已与用户逐一确认取舍方向，并经过一轮 opus 只读审阅（发现并修正了 2 个真实防剧透泄漏 + 3 个重要问题，详见文末"审阅纪要"）。**本次改动全是纯 JS/TS，无新原生依赖，可走 EAS Update OTA，无需重出 ipa。**

## Context（为什么做）

用户真机试用增量 8 后反馈：

1. **条目质量很一般**：人物简介是一堆近似重复的碎片句子堆叠（如"出身贫寒的少年"/"来自贫困家庭的少年"/"家境贫寒"三条并列），从未被整合成一段连贯的话。根因：`codexExtract.ts` 的抽取 prompt 只要求输出裸 JSON 字符串数组、零文笔/整合要求；`codexMerge.ts` 的合并只做**精确字符串+idx** 去重，近似重复的表述永远不会被识别为重复，会随着章节增多无限堆积（该文件自己的注释也承认这是刻意推迟到真机验证的已知风险，现在正是这个风险应验）。
2. **关系图一团乱**：势力聚类布局（`factionLayout.ts`）的簇半径无碰撞检测（成员多的门派会和相邻门派的圆环重叠）、边全是直线穿插、标签无防重叠、节点/画布尺寸固定不随设备或密度自适应、且完全没有缩放。用户进一步质疑**整体网状图这个呈现形式本身**是否适合手机端 30+ 人物的场景——已确认改用「按势力分组的树状/标签列表」+「人物卡内嵌以我为中心的小型关系图」。
3. **原始难检索**：`CodexModal.tsx` 零搜索/过滤能力，人物列表是不虚拟化的纯 `.map()`，别名/势力/事件线等字段被抽取并通过防剧透过滤，却从未在 UI 上展示过。

已与用户确认的两个方向性决策（这两条不再重新讨论，只讨论怎么实现）：

- **内容质量**：加一道**整合润色 LLM pass**（用户明确接受为此多付出真实 API 调用延迟/token 成本）。
- **关系呈现**：**放弃整体网状图**，换成分组树状列表（关系图 tab）+ 人物卡内嵌的小型「以我为中心」关系图（≤8 节点，永不拥挤）。

## 全局约束（延续增量 8 红线，新增内容不得违反）

- **`codexForCutoff`（`src/lib/ai/codex.ts`）是唯一防剧透过滤入口**——任何新字段（如润色简介）必须走同样的 `{text, idx}[]` 版本化字段模式，被这一个函数过滤，UI/新模块永不直接读裸 `Codex`。
- **所有 idx 一律代码盖章**，绝不采信 LLM 自报——新增的润色 pass 产出的 idx 是代码计算值（批次级统一盖章，见下）。
- `ai_codex` 表的 `json` 字段是**不透明 blob**（`repository.ts:86`），新增 `Character.bio`/`Term.gloss` 字段无需任何 SQLite 迁移，直接随 JSON.stringify 落盘。
- `CODEX_PROMPT_VERSION` 升到 `v2`，遵循既有版本容忍约定：**不自动重建**旧图鉴，只增量补全；用户仍可显式点「重建图鉴」全量重抽。
- 主题色沿用 `theme.text/heading/subtle/accent`（`CodexModal.tsx` 现有 token 系统），新样式不得硬编码十六进制色值，结构上借鉴 `LibraryScreen.tsx` 的卡片/阴影/小标题样式和 `TocSheet.tsx`/`FullTextPanel.tsx` 的搜索框样式。

## 一、内容质量：润色 pass

### 数据模型（`src/lib/ai/codex.ts`）

```ts
Character.bio?: TextAtIdx[];   // 版本化整合简介
Character.bioHash?: string;    // 代码计算的碎片指纹，仅用于判断是否需要重新润色，绝不进入展示
Term.gloss?: TextAtIdx[];      // 版本化整合释义（原 def[] 碎片史保留，作为兜底）
Term.glossHash?: string;
```

`codexForCutoff` 抽出一个通用 `latestAtIdx(arr, cutoff): T[]` helper，**语义与现有 `Term.def` 归约逻辑完全一致**（过滤 ≤cutoff 后取**单条最新**，不是"全部 ≤cutoff"，也不是"第一条"）：`bio`/`gloss` 复用这同一个 helper，返回 `[]` 或 `[单条最新]`。`bioHash`/`glossHash` 不进入 `codexForCutoff` 的显式字段枚举，天然不泄漏（延续现有实现"逐字段枚举构造输出对象"的写法）——需要一个测试专门断言过滤后的输出对象没有 `bioHash` key。**展示层兜底**：`bio` 过滤后为空则显示原始碎片（`identity`/`origin`/`events` 过滤后拼接），非空则显示 `bio[0].text`——回退阅读进度到润色点之前时自动降级为碎片视图，不会展示超前内容。

### 合并层加固（`codexMerge.ts`）

新增**包含关系去重**（非精确字符串匹配的补充，非替代）：新碎片的规范化文本若是已存在碎片的子串（或反之），保留**更长者**。

**关键红线**：保留更长者时，**idx 取被保留的那条（更长的那条）自身的 idx，绝不取两者中的较小值，也绝不沿用被丢弃的较短碎片的 idx**。例如 idx=10 的碎片"出身贫寒的少年"是 idx=200 的碎片"出身贫寒的少年，后来弑父夺得魔教教主之位"的子串——若按"取较小 idx"合并，这句含 idx=200 才该揭示的信息会被错误盖章成 idx=10，导致 cutoff=50 的读者提前看到。去重只影响"留哪条文本"，不改变被留下这条文本原有的 idx。

目的：在 2000 章/~130 块的长书里，让碎片数组在真正进入润色 pass 之前就有个上界，避免单次润色调用的输入 token 爆炸。刻意只做「包含关系」而非模糊相似度，避免把两个措辞不同但确有信息差的碎片误判为重复。

### 新模块 `src/lib/ai/codexPolish.ts`

- 纯函数部分：`characterFragmentHash(c)`/`termFragmentHash(t)`（对**参与润色的全部碎片字段**——人物是 `identity+origin+events`，词条是 `def`——排序后做确定性指纹，避免并发/合并顺序导致误判"脏"；**指纹覆盖的字段集合必须和喂给润色 prompt 的字段集合完全一致**）、`isCharacterDirty(c)`/`isTermDirty(t)`（`bioHash` 缺失或不匹配当前指纹 ⇒ 脏）。
- LLM 部分：`polishCodex(deps:{chat}, params:{codex, signal?, onProgress?})`。**只挑脏的人物/词条**，每次调用批量打包 **~6 个实体**，复用 `runPool` 并发 3。
  - 人物 prompt：把同一人物零散碎片整合成一段连贯第三人称简介，只用给定信息、不新增不推测、60–140 字、不出现章节序号；输出 `{"bios":[{"name","bio"}]}`。
  - 词条 prompt：仅对**碎片数 ≥2** 的词条润色，输出 `{"glosses":[{"name","gloss"}]}`。
  - `responseFormat: 'json_object'`。

  **关键红线**：`extractCodex` 的 `stampBlock` 之所以安全，是因为一个块里的**所有**实体统一盖章为块的 `maxIdx`——哪怕模型把 A 的信息串到了 B 头上，B 也不会因此提前泄漏。润色同理：**同一次 LLM 调用产出的所有实体，一律盖章为这次调用输入的全部碎片中的最大 idx（批次级统一盖章）**，绝不逐实体各自计算自己碎片的最大 idx。原因：LLM 跨实体信息串扰是真实会发生的失败模式（"只用给定信息"这句 prompt 约束并不能阻止，因为串错的信息本来就在这批 prompt 的输入里）——若一批里既有信息量大、追到很后面章节的主角，也有只读到很早期的次要人物，逐实体盖章会让次要人物的简介按自己过早的 idx 展示，从而泄漏批内串到它头上的主角剧情。批次级统一盖章会让个别本该更早出现的简介稍微延后才展示（安全的保守方向：宁可晚出现，绝不早出现）。
  - 写入前与最后一条 `bio`/`gloss` 文本比对，相同则不追加；坏 JSON/缺 name 的实体本轮跳过、保持脏状态下轮重试，绝不整体抛异常。

### 编排（`ensureCodex.ts`）

**触发时机**：`ensureCodex` 的抽取循环推进到不再有新章节可抽（即达到/追平 `cutoff`）时，检查是否存在脏实体（人物或词条），有则跑一次 `polishCodex` 并持久化；抽取过程中的中间 checkpoint **不触发润色**。这一处逻辑同时覆盖"首次一次性追赶到底"和"已经追上、无新章节但有脏实体"两种场景。

理由：若改成每个 checkpoint（`CHECKPOINT_EVERY_BLOCKS=5` = 75 章）都跑一次润色，在 2000 章/~60 人物的书上粗估会比现有抽取多出约 270 次额外 LLM 调用（约等于把总请求量再翻 3 倍），直接加剧"图鉴加载有点慢"的既有反馈。只在追上 cutoff 时跑一次，最坏情况下一次性追赶只需要一轮润色（约 10-60 次调用，视脏实体数量）。因为 `ReaderScreen` 每次打开图鉴都会重跑 `ensureCodex`，实际效果是"每个阅读会话追上进度后润色一次"。

**原子性**（这条路径没有像抽取的 checkpoint 循环那样天然的落盘节奏，需专门规定）：

- 单个实体内部，**先 append `bio`，再设置 `bioHash`，中间不能有任何 `await`**——保证一次中断只可能让实体停留在"完全脏"状态（安全，下次会重新润色），不会出现"哈希已更新但简介没写"的半更新状态。
- 整个润色 pass 只在跑完全部批次后 **持久化一次**，落盘时 `coveredUptoIdx` 保持不变。复用现有的 per-book 锁（`withBookLock`）保证互斥，不需要新的锁机制。
- 取消在批次之间检查即可，触发时直接抛出、不落盘本轮已完成但尚未持久化的部分。

其余：新增 `polishChat: PolishChatFn` 到 `EnsureCodexDeps`（`ReaderScreen` 注入，独立的 `maxTokens`/`temperature`/`json_object` 配置）；`CODEX_PROMPT_VERSION` 升到 `'v2'`，遵循版本容忍约定；进度条区分润色阶段（避免卡在 100% 让用户以为卡死）；是否自动触发沿用现有 `autoOn`（=`aiConfig.autoSummarize`）语义，不引入新开关。

## 二、关系呈现：网状图 → 分组树状列表 + 人物卡内嵌小图

### `src/lib/ai/factionLayout.ts` → 改名重做为 `src/lib/ai/codexRelations.ts`

删除整个空间布局算法（`layoutFactionGraph` 及其半径/角度几何），**保留并导出** `primaryGroup(c)`/`UNGROUPED='散'`（当前是模块私有，需要改成 export）。新增：

```ts
export const TREE_KINDS: ReadonlySet<string>; // 师徒/师父/父子/母子/亲缘/主仆... 的白名单
export function isTreeKind(kind: string): boolean; // 非 LLM 判断，纯字符串归一化匹配

export function buildGroupedRoster(characters: Character[], relations: Relation[]): GroupSection[];
// 按 primaryGroup 分组；组内 TREE_KINDS 关系（from=长辈/师父方向）縮进成树；
// 跨组关系 + 组内非树关系 → 该人物行上的可点击标签芯片（tap 跳转）；
// 防环/多父：只挂在第一个分配到的父节点下，孤儿节点作为根

export function egoNetwork(focalName, characters, relations, opts:{width,height,cap=8}): {nodes, edges};
// 焦点节点居中，最多 cap 个直接关系人物均匀环绕一圈，纯固定几何、无需碰撞检测
```

**关键问题**：`Relation.kind` 的方向是 LLM 在每个抽取块里独立推断出来的自由文本，**没有跨块一致性校验**；`codexMerge.ts` 的去重 key 是 `from+to+kind` 精确匹配，意味着 `(A,B,师徒)` 和 `(B,A,师徒)` 会被当成两条不同关系**同时保留**。若不处理：前期块判断"A 是师父"，后期某块判断反了，`buildGroupedRoster` 的"先到者赢"防环规则会按处理顺序随机决定谁是谁的师父，被丢弃的反向关系还可能落进标签芯片路径，造成同一对关系**既在树里出现一次、又在芯片里重复出现一次**——这是旧的整图版本从未出现过的新失败模式。

**修正**：`buildGroupedRoster` 处理 TREE_KINDS 关系前，先按**无序对+kind**归一化（如 `sortedPairKey(a,b)+kind`），把互为反向的重复关系**合并成一条**，方向按确定性规则选定；已经作为树边渲染的这一对人物，**必须排除在芯片候选之外**。需要专门测试：喂入互相矛盾的 `(A,B,师徒)`+`(B,A,师徒)`，断言只产生一条树边、且没有重复芯片。

`from`=长辈/师父方向 是本次采用的简化约定，配合归一化处理后是确定性、无重复的实现，真机验收时观察实际效果是否需要进一步调整。

### 组件

- 新增 `src/reader/RelationRoster.tsx`：关系图 tab 的新内容，`SectionList` 渲染 `GroupSection[]`，组标题为势力 eyebrow，组内按 `depth` 缩进，跨组/非树关系渲染为可点标签。
- 新增 `src/reader/EgoGraph.tsx`：替代 `RelationshipGraph.tsx`，消费 `egoNetwork` 输出，`react-native-svg` 渲染（`Circle`/`Line`/`SvgText`），尺寸用 `useWindowDimensions()`；≤8 节点，不需要 PanResponder。嵌入人物详情卡。
- **删除** `RelationshipGraph.tsx`、`src/reader/__tests__/RelationshipGraph.test.tsx`、`src/lib/ai/__tests__/factionLayout.test.ts`（后者锁定的 `maxNodes=30`/退化/悬边丢弃等行为随 `layoutFactionGraph` 一起被删除，必须同步删除/改写）、`layoutFactionGraph` 导出。

两个新组件都只接受已经过 `codexForCutoff` 过滤的 `characters`/`relations`，纯函数、无内部再次过滤——延续增量 8 「不持有裸 codex+cutoff」的纪律。

## 三、UI/检索：`CodexModal.tsx` 视觉与可用性重做

新增纯函数模块 `src/lib/ai/codexSearch.ts`（仿 `src/lib/reader/toc.ts` 的 `filterChapters`）：

```ts
filterCharacters(chars, q): Character[]  // 匹配 name/aliases/groups/首条 identity 或 bio
filterTerms(terms, q): Term[]            // 匹配 name/def/gloss
```

`CodexModal.tsx` 改动：

- Tab 栏改为分段胶囊样式（active=`theme.accent` 填充，inactive=`hexToRgba(theme.subtle,0.12)`），去掉裸文字 tab。
- **人物 tab**：顶部搜索框（复用 `AiPanel.tsx` 输入框样式）+ `FlatList`（替换不虚拟化的 `.map()`）卡片行：主文字用 `theme.heading`，副标题一行显示势力标签+首条 `bio`/`identity` 预览（`numberOfLines=1`）。
- **人物详情卡**：真正的卡片/头部布局，补全此前**从未渲染过**的字段——别名（芯片行）、势力（芯片行）、简介（`bio` 优先，无则退回碎片）、身世、**事件线**（此前完全没展示过，做成竖向时间线列表）、关系（内嵌 `EgoGraph` + 跨组标签）。
- **世界观 tab**：搜索框 + `SectionList` 按 `category` 分组、组标题用 `LibraryScreen.tsx` 风格的小标题。
- **关系图 tab**：整体替换为 `<RelationRoster onSelectCharacter={跳转到人物 tab 并选中} />`。
- 进度条支持"整合润色中…"独立阶段文案。
- 清理所有硬编码色值（如 `rgba(127,127,127,0.2)` 分隔线）和固定画布尺寸（`width={320} height={420}`），全部换成 `theme.*`/`hexToRgba`/`useWindowDimensions`。

## 已确认的实现默认值

- 润色只在追上 cutoff、无更多章节可抽时跑一次（不在每个中间 checkpoint 触发）。
- 词条只对碎片数 ≥2 的才润色。
- 树形关系方向约定 `from=长辈/师父`，配合互为反向关系的归一化去重。
- 润色批次内所有实体统一盖章为该批次输入碎片的最大 idx（而非逐实体各自计算）。

## Verify

- **自动**：`codexForCutoff`（`bio`/`gloss` 回退降级取单条最新、hash 不泄漏）；`codexMerge`（包含去重保留长文本自身 idx、红线不受影响）；`codexPolish`（脏检测确定性、批量润色、批次级统一 idx 盖章、坏 JSON 容错、取消、entity 内原子更新）；`ensureCodex`（仅追上 cutoff 时润色一次、单次持久化、v2 版本容忍不自动重建）；`codexRelations`（分组/树/防环/矛盾方向去重/ego 几何确定性）；`codexSearch`（过滤命中）；`RelationRoster`/`EgoGraph`/`CodexModal` 组件测试。`npm test` 全绿 / `tsc` 干净 / `expo export ios` 成功。
- **真机（本增量全 JS，走 OTA 即可，不需要重出 ipa）**：（1）人物简介读起来是连贯的一段话而非碎片堆砌，事件线/别名/势力标签均可见；（2）关系图 tab 呈现为按势力分组的树状/标签列表，可读不拥挤，矛盾方向的关系不会重复出现在树和标签里；（3）人物卡内嵌的小型关系图清晰、可点跳转；（4）搜索框可按人物名/别名/势力/词条名/释义命中过滤；（5）**防剧透终极验证**：回退阅读进度后简介/释义自动降级到该进度已知的版本，无超前内容泄漏（重点验证：一个简介后来被更长文本合并过的人物，回退到合并前的进度时不应看到合并后才有的信息）；（6）已有的旧图鉴数据（增量 8 真机测试时生成的）在本增量上线后无需「重建图鉴」也能通过「补全到当前进度」逐步获得简介（版本容忍）；（7）图鉴打开时进度条在润色阶段有独立提示，不会卡在 100% 让人以为卡死。

## 明确不做（本次）

不重新引入整体网状关系图；不做 LLM 语义级近似去重（只做代码层的包含关系兜底）；不改变 `autoSummarize`/`consentAt` 等既有成本与同意门控语义；不做跨书图鉴/图鉴导出。

## 审阅纪要（opus，只读，实现前一轮）

对本方案做了一轮 severity 分级的对抗性评审，发现：

- **Critical ×2**（均已修正并写入上文）：(1) 合并去重"取更小 idx"会让被合并保留的长文本提前泄漏，改为"取被保留文本自身的 idx"；(2) 批量润色若逐实体各自盖章 idx，LLM 跨实体信息串扰会导致次要人物提前泄漏主角剧情，改为批次级统一盖章（复用抽取阶段 `stampBlock` 的既有规则）。
- **Important ×3**（均已修正并写入上文）：(1) 每 checkpoint 润色一次的频率经估算会让最坏情形多出约 270 次调用，改为只在追上 cutoff 时跑一次；(2) 追上-补跑路径缺少原子性规定，已补充"entity 内 append 后立即设 hash 无 await + 整个 pass 单次持久化"；(3) 关系方向逐块独立推断、无跨块一致性，会产生"树边+重复芯片"的新可见 bug，已补充归一化去重规则。
- **Minor ×2**：进度条在润色阶段的展示（已写入 UI 与编排两节）；`factionLayout.test.ts` 需要随 `layoutFactionGraph` 一起删除（已补进任务范围）。
- 审阅同时确认方案的整体骨架（版本化 `{text,idx}[]` 字段 + 单一过滤入口 + 碎片兜底）方向正确，`ai_codex` blob 免迁移、`bioHash` 结构性不泄漏、per-book 锁复用、ego 网络/roster 只吃过滤后数据这几点均核实无误、无需改动。
