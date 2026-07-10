# AI 伴读离线质检 / 回归工具

用**真实模型**（默认 DeepSeek，OpenAI 兼容）对 `reference/example_novels/` 的真实样本书跑「AI 伴读」全链路，检验**质量**（小结保真、回顾/问书/人物准确）与**防剧透**（结构层 + 行为层）。换模型、改 prompt、调 `selectContext`/预算后，跑一遍看有没有回归。

> 这是 Jest 单测测不到的一层：单测用假 `chat`/`fetch` 只验管道与结构；本工具真调模型，验**模型吐出来的东西好不好、听不听话**。

## 用法

```bash
# 4 本浅测矩阵（3 种编码 × 4 题材，各读 26 章，触发 1 条弧）
node scripts/ai-eval/eval.mjs

# 深读单本，压测多级弧归并 + 早期情节召回（默认 凡人 读到 200 章）
node scripts/ai-eval/eval.mjs deep 凡人修仙传.txt gb18030 200

# 换服务/模型
AI_EVAL_BASE_URL=https://ark.cn-beijing.volces.com/api/v3 AI_EVAL_MODEL=xxx \
  DEEPSEEK_KEY_FILE=/path/to/key node scripts/ai-eval/eval.mjs
```

- **key**：默认读 `D:/Games/API_KEY.txt`（可用 `DEEPSEEK_KEY_FILE` 覆盖）。文件可以是一行 `sk-...`，或多行「厂商: key」清单——脚本取含 `deepseek` 那行冒号后的值。key **不会被打印/写入报告**。
- **报告**：写入 `scripts/ai-eval/out/report-<时间>.txt`（已 gitignore）。终端只印判定与统计。
- **样本书**：来自 `reference/`（本身已 gitignore，版权原因不入库）。

## 它检查什么

每本书：小结逐章保真度抽查、弧小结、剧情回顾、问已读准确性、**早期情节召回**（压弧骨架）、**剧透探针 ×3**（直问后续 / 诱导按伏笔推测 / 人物「最终 boss」）。终端判定行给出：早期召回是否答出、三个剧透探针是否拒答、深读时弧是否真的被纳入。

深读模式额外验证：早期章被挤出章级细节后，`selectContext` 是否仍用**弧小结骨架**保住早期历史（`用弧` 应非空）。

## ⚠️ 逻辑镜像 —— 改源码要同步

`eval.mjs` 里的 prompt 和 `selectContext` 是从生产源码**逐字复制**来的（Node .mjs 无法直接 import 项目的 .ts）。**改了下列任一处，务必同步 `eval.mjs`，否则质检结果不代表线上：**

| 源文件 | 镜像的东西 |
|---|---|
| `src/lib/ai/summarize.ts` | `chapterSummaryMessages` / `arcSummaryMessages` / `ARC_SIZE` |
| `src/lib/ai/companion.ts` | `SPOILER_RULE` / `askBookMessages` / `storySoFarMessages` / `characterMessages` |
| `src/lib/ai/context.ts` | `selectContext` / `CONTEXT_BUDGET` |
| `src/screens/ReaderScreen.tsx` | 小结 `maxTokens: 400` / `temperature: 0.3` |

## 成本 / 隐私

- 会把样本书**正文**发送到你配置的模型服务。只用你自己的 key、自负费用（DeepSeek 极便宜：浅测矩阵 ~¥0.2，深读 200 章 ~¥0.3）。
- 深读 200 章约 2 分钟（并发 6）；1000 章外推约 10 分钟。
