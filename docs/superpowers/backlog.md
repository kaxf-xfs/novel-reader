# NovelReader — Backlog（延后但保留分析）

导入翻车时的补救工具。用户选择：自用测试遇到坏书时直接反馈让我修复，
暂不在 App 内建这两套手动工具（YAGNI）。真遇到高频需求再实现。

## 章节解析手动修正（延后）

**问题**：解析靠正则（第X章/回/卷）+ 启发式。盗版 txt 格式乱会出错：
- 漏分 → 整本变 1–2 个巨型"章"，目录/进度%/滑窗都失效。
- 误分 → 叙事行（如"第二天"）被当成章，目录塞满假章。
- 策略错 → 卷/章层级被拍平。

**技术可行性**：✅ 不卡。UTF-8 副本仍在 `normalizedPath`。
- 读整份 UTF-8 文本（需给 FileGateway 加一个"读整份文件为字符串"或用 sizeBytes 的
  UTF-8 字节长度 readRange；注意 `BookRecord.sizeBytes` 是**原始**字节数，不是
  normalized 的，重解析前要拿 normalized 文件实际字节长度）。
- 重跑 `buildChapterIndex(text, options?: ParseOptions)`（`ParseOptions` 可调
  `minChapters` / `maxTitleLen` / `adPatterns`），得到新 `ChapterIndex`。
- 替换该书 chapters：需给 repo 加 `replaceChapters(bookId, chapters)`（先删后插）。
- 重解析后阅读进度可能失配（章数变了）→ 需把 progress 归零或夹到新范围。

**UI 草案**：书籍管理里「重新解析章节」→ 可选策略/参数 → 预览章数 → 确认替换。

## 编码手动覆盖（延后）

**问题**：编码探测（jschardet 启发式）会猜错，尤其 GBK/GB18030/Big5 之间或开头
文本少时 → 整本乱码，且当前删除重导会重复同样的错误探测，无法强制。

**技术卡点**：⚠️ 导入**只保留转码后的 UTF-8 副本，原始字节未留**
（`importBook` 只写 `normalizedPath`，存了 `encoding` 名和 `sizeBytes` 但没存原文）。
乱码副本无法逆转回原字节。两条路：
- **A（改动小）**：让用户**重新选一次原 txt**，用 `decodeToUtf8(bytes, encoding)`
  强制指定 `SupportedEncoding`（`'utf-8'|'utf-8-bom'|'gb18030'|'big5'`）重导入
  （复用 `importBook`，加一个 `forceEncoding` 参数绕过 `detectEncoding`）。
- **B（每本多占 15–20MB）**：改导入额外持久化原始字节，日后可原地换编码重解码。

**推荐**：若要做，走 A（重选文件 + 强制编码），改动最小、不额外占磁盘。
