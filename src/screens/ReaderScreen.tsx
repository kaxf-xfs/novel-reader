/**
 * T4/T7: ReaderScreen — vertical continuous-scroll reader over a sliding
 * window of chapters, backed by byte-range reads so the whole book is never
 * loaded into memory.
 *
 * T7 chrome: top + bottom bars are immersive overlays toggled by tapping the
 * center of the page. The top bar shows the chapter title + system clock &
 * battery; the bottom bar carries the thumb-reachable controls (目录 / 上一章 /
 * 进度 / 下一章 / 排版). A table-of-contents sheet (with search) jumps to any
 * chapter.
 *
 * Scrolling model: downward is seamless infinite scroll (onEndReached appends
 * the next chapter); upward uses a "加载上一章" header button with
 * maintainVisibleContentPosition to keep the scroll position stable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type ViewToken,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { FileGateway } from '../lib/import/importBook';
import type { Bookmark, BookRecord, BookRepository, ChapterRecord } from '../lib/import/repository';
import { readChapterText } from '../lib/reader/readChapter';
import { splitBlocks } from '../lib/reader/blocks';
import { findBlockArrayIndex } from '../lib/reader/restore';
import { chapterProgressPercent, chapterProgressPercentPrecise } from '../lib/reader/progress';
import { makeSnippet } from '../lib/reader/snippet';
import { useReaderStatus } from '../lib/reader/useReaderStatus';
import { computeReaderStyles } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';
import { ReaderSettingsSheet } from '../settings/ReaderSettingsSheet';
import { TocSheet } from '../reader/TocSheet';
import { ProgressJumpSheet } from '../reader/ProgressJumpSheet';
import { BookmarksSheet } from '../reader/BookmarksSheet';

interface ReaderScreenProps {
  repo: BookRepository;
  fs: FileGateway;
  bookId: string;
  onBack: () => void;
}

interface FlatBlockItem {
  key: string;
  chapterIndex: number;
  blockIndex: number;
  text: string;
  isTitle: boolean;
}

const WINDOW_RADIUS = 1;
const PROGRESS_SAVE_DEBOUNCE_MS = 800;
/** Two ideographic spaces → 起点-style 2-character first-line paragraph indent. */
const PARA_INDENT = '　　';

async function loadChapterBlocks(
  fs: FileGateway,
  normalizedPath: string,
  chapter: ChapterRecord,
  cache: Map<number, string>,
): Promise<FlatBlockItem[]> {
  let text = cache.get(chapter.index);
  if (text === undefined) {
    text = await readChapterText(fs, normalizedPath, chapter);
    cache.set(chapter.index, text);
  }
  return splitBlocks(text).map((blockText, i) => ({
    key: `${chapter.index}-${i}`,
    chapterIndex: chapter.index,
    blockIndex: i,
    text: blockText,
    isTitle: i === 0,
  }));
}

export function ReaderScreen({ repo, fs, bookId, onBack }: ReaderScreenProps) {
  const { settings } = useSettings();
  const rs = useMemo(() => computeReaderStyles(settings), [settings]);
  const status = useReaderStatus();

  const [showSettings, setShowSettings] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  // The slim top bar is always visible; tapping the page toggles the bottom
  // control bar. Start immersive (controls hidden), 起点-style.
  const [chromeVisible, setChromeVisible] = useState(false);

  const [book, setBook] = useState<BookRecord | null>(null);
  const [chapters, setChapters] = useState<ChapterRecord[] | null>(null);
  const [blocks, setBlocks] = useState<FlatBlockItem[]>([]);
  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(0);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  // While true, the reading surface is masked (opacity 0) so the user never
  // sees the list settle from the top to a restored/jumped position.
  const [restoring, setRestoring] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingAbove, setLoadingAbove] = useState(false);
  const [loadingBelow, setLoadingBelow] = useState(false);

  const chapterTextCache = useRef(new Map<number, string>());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<FlatBlockItem>>(null);
  const currentBlockIndexRef = useRef(0);
  const pendingRestoreRef = useRef<{ chapterIndex: number; blockIndex: number } | null>(null);
  // While a mid-chapter restore/jump is settling, holds the anchor we're
  // scrolling toward so onViewableItemsChanged can reveal the surface the
  // moment the anchor reaches the top (rather than after a guessed delay).
  const restoreTargetRef = useRef<{ chapterIndex: number; blockIndex: number } | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `restoring` for use inside async callbacks, plus a mounted flag so a
  // late timer/rAF reveal never setState after unmount (avoids act() warnings
  // and no-op reveals when the surface was never masked).
  const restoringRef = useRef(false);
  const mountedRef = useRef(true);

  const mask = useCallback(() => {
    restoringRef.current = true;
    setRestoring(true);
  }, []);
  const reveal = useCallback(() => {
    if (!mountedRef.current || !restoringRef.current) return;
    restoringRef.current = false;
    setRestoring(false);
  }, []);

  // ── Tap-vs-scroll detection for toggling the chrome ───────────────────
  // Passive touch handlers on a plain View wrapper: they observe touches
  // WITHOUT claiming the responder, so the FlatList scrolls normally. A tap
  // is a touch that ends near where it began, quickly, with no drag.
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const touchMovedRef = useRef(false);

  const onSurfaceTouchStart = useCallback((e: GestureResponderEvent) => {
    const touch = e.nativeEvent.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.pageX, y: touch.pageY, t: Date.now() };
    touchMovedRef.current = false;
  }, []);

  const onSurfaceTouchMove = useCallback((e: GestureResponderEvent) => {
    const start = touchStartRef.current;
    const touch = e.nativeEvent.touches[0];
    if (!start || !touch) return;
    if (Math.abs(touch.pageX - start.x) > 8 || Math.abs(touch.pageY - start.y) > 8) {
      touchMovedRef.current = true;
    }
  }, []);

  const onSurfaceTouchEnd = useCallback(
    (e: GestureResponderEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;

      // Tap (no drag, quick) → toggle chrome.
      if (!touchMovedRef.current && Date.now() - start.t < 300) {
        setChromeVisible((v) => !v);
        return;
      }

      // Left-edge rightward swipe → back to the shelf (iOS-style).
      const end = e.nativeEvent.changedTouches[0];
      if (end) {
        const dx = end.pageX - start.x;
        const dy = end.pageY - start.y;
        if (start.x < 40 && dx > 60 && dx > Math.abs(dy) * 2) {
          onBack();
        }
      }
    },
    [onBack],
  );

  // Load a forward window STARTING at `index` (the target chapter sits at the
  // top of the list, so an open/jump lands exactly on that chapter — not the
  // previous one). Upward chapters load on demand via the "加载上一章" header.
  const loadWindow = useCallback(
    async (bk: BookRecord, chs: ChapterRecord[], index: number) => {
      const start = Math.min(Math.max(index, 0), chs.length - 1);
      const end = Math.min(chs.length - 1, start + WINDOW_RADIUS);
      const indices: number[] = [];
      for (let i = start; i <= end; i++) indices.push(i);
      const built: FlatBlockItem[] = [];
      for (const idx of indices) {
        built.push(
          ...(await loadChapterBlocks(fs, bk.normalizedPath, chs[idx], chapterTextCache.current)),
        );
      }
      return { indices, blocks: built };
    },
    [fs],
  );

  // ── Initial load: book record + chapters + saved progress ─────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError(null);
      try {
        const [books, chs, progress] = await Promise.all([
          repo.listBooks(),
          repo.getChapters(bookId),
          repo.getProgress(bookId),
        ]);
        const foundBook = books.find((b) => b.id === bookId) ?? null;
        if (!foundBook) throw new Error('未找到这本书');
        if (chs.length === 0) throw new Error('这本书没有解析出章节');

        const startIndex = Math.min(progress?.chapterIndex ?? 0, chs.length - 1);
        const { indices, blocks: initialBlocks } = await loadWindow(foundBook, chs, startIndex);
        if (cancelled) return;

        setBook(foundBook);
        setChapters(chs);
        setLo(indices[0]);
        setHi(indices[indices.length - 1]);
        setBlocks(initialBlocks);
        setCurrentChapterIndex(startIndex);

        const savedBlock = progress?.charOffset ?? 0;
        currentBlockIndexRef.current = savedBlock;
        if (savedBlock > 0) {
          // Mid-chapter position: mask the surface and let the restore effect
          // scroll to the block once it is rendered (no visible scroll journey).
          pendingRestoreRef.current = { chapterIndex: startIndex, blockIndex: savedBlock };
          mask();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [bookId, repo, fs, loadWindow]);

  // Clear any pending timers on unmount.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, []);

  // Position the list at the pending anchor (initial restore OR a jump) once
  // the target block is present, then reveal the surface. The reveal timer is
  // NOT tied to this effect's cleanup, so an unrelated `blocks` change (e.g. a
  // chapter append) can't cancel it and leave the surface stuck hidden.
  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || blocks.length === 0) return;
    const arrayIndex = findBlockArrayIndex(blocks, pending.chapterIndex, pending.blockIndex);
    pendingRestoreRef.current = null;

    if (arrayIndex > 0) {
      // Scroll down into the chapter. Reveal is driven by arrival detection in
      // onViewableItemsChanged (so long chapters don't reveal mid-scroll); the
      // timer is only a safety net if viewability never reports the anchor.
      restoreTargetRef.current = pending;
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: arrayIndex, animated: false });
      });
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      revealTimerRef.current = setTimeout(() => {
        restoreTargetRef.current = null;
        reveal();
      }, 1500);
    } else {
      // block 0 (or anchor missing) → the chapter is already at the top.
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        reveal();
      });
    }
  }, [blocks]);

  const loadMoreBelow = useCallback(async () => {
    if (!chapters || !book) return;
    if (loadingBelow || hi >= chapters.length - 1) return;
    setLoadingBelow(true);
    try {
      const nextIndex = hi + 1;
      const chBlocks = await loadChapterBlocks(
        fs,
        book.normalizedPath,
        chapters[nextIndex],
        chapterTextCache.current,
      );
      setBlocks((prev) => [...prev, ...chBlocks]);
      setHi(nextIndex);
    } finally {
      setLoadingBelow(false);
    }
  }, [chapters, book, hi, fs, loadingBelow]);

  const loadPreviousChapter = useCallback(async () => {
    if (!chapters || !book) return;
    if (loadingAbove || lo <= 0) return;
    setLoadingAbove(true);
    try {
      const prevIndex = lo - 1;
      const chBlocks = await loadChapterBlocks(
        fs,
        book.normalizedPath,
        chapters[prevIndex],
        chapterTextCache.current,
      );
      setBlocks((prev) => [...chBlocks, ...prev]);
      setLo(prevIndex);
    } finally {
      setLoadingAbove(false);
    }
  }, [chapters, book, lo, fs, loadingAbove]);

  // Jump to a chapter (optionally to a specific in-chapter block, e.g. a
  // bookmark). Rebuild the forward window and let the restore effect land the
  // list on the anchor while the surface is masked — no visible scroll.
  const jumpToChapter = useCallback(
    async (target: number, targetBlockIndex = 0) => {
      if (!book || !chapters) return;
      const clamped = Math.min(Math.max(target, 0), chapters.length - 1);
      const { indices, blocks: newBlocks } = await loadWindow(book, chapters, clamped);
      pendingRestoreRef.current = { chapterIndex: clamped, blockIndex: targetBlockIndex };
      // Chapter-start jumps land at the top with no scroll, so no mask needed;
      // only mask when we have to scroll down into the chapter (a bookmark).
      if (targetBlockIndex > 0) mask();
      setBlocks(newBlocks);
      setLo(indices[0]);
      setHi(indices[indices.length - 1]);
      setCurrentChapterIndex(clamped);
      currentBlockIndexRef.current = targetBlockIndex;
      repo.saveProgress({
        bookId,
        chapterIndex: clamped,
        charOffset: targetBlockIndex,
        updatedAt: Date.now(),
      });
    },
    [book, chapters, loadWindow, repo, bookId],
  );

  // 打开书签列表时刷新（先展示 sheet，再异步填充列表，避免列表加载延迟阻塞开关反馈）
  const openBookmarks = useCallback(async () => {
    setShowBookmarks(true);
    setBookmarks(await repo.listBookmarks(bookId));
  }, [repo, bookId]);

  // 章标题查表（供列表展示）
  const chapterTitles = useMemo(() => {
    const map: Record<number, string> = {};
    for (const c of chapters ?? []) map[c.index] = c.title;
    return map;
  }, [chapters]);

  // 收藏当前位置：取当前顶部锚点 + 该段摘要
  const addCurrentBookmark = useCallback(async () => {
    const ci = currentChapterIndex;
    const bi = currentBlockIndexRef.current;
    const item = blocks.find((b) => b.chapterIndex === ci && b.blockIndex === bi);
    // 标题块无正文内容时，退回到该章首个正文段作摘要
    const snippetSource =
      item && !item.isTitle
        ? item.text
        : blocks.find((b) => b.chapterIndex === ci && !b.isTitle)?.text ?? '';
    await repo.addBookmark({
      id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      bookId,
      chapterIndex: ci,
      blockIndex: bi,
      snippet: makeSnippet(snippetSource),
      createdAt: Date.now(),
    });
    setBookmarks(await repo.listBookmarks(bookId));
  }, [repo, bookId, currentChapterIndex, blocks]);

  // 回跳：跳到书签的章 + 章内段落（jumpToChapter 内部会设 pendingRestore + 遮罩）
  const jumpToBookmark = useCallback(
    (chapterIndex: number, blockIndex: number) => {
      jumpToChapter(chapterIndex, blockIndex);
    },
    [jumpToChapter],
  );

  const deleteBookmark = useCallback(
    async (id: string) => {
      await repo.deleteBookmark(id);
      setBookmarks(await repo.listBookmarks(bookId));
    },
    [repo, bookId],
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length === 0) return;
      const topItem = viewableItems[0].item as FlatBlockItem;
      setCurrentChapterIndex(topItem.chapterIndex);
      currentBlockIndexRef.current = topItem.blockIndex;

      // Mid-chapter restore/jump in progress: reveal the surface the instant
      // the anchor block reaches the top, and skip saving intermediate
      // positions passed during the settle scroll.
      const target = restoreTargetRef.current;
      if (target) {
        const arrived =
          topItem.chapterIndex > target.chapterIndex ||
          (topItem.chapterIndex === target.chapterIndex && topItem.blockIndex >= target.blockIndex);
        if (arrived) {
          restoreTargetRef.current = null;
          if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
          reveal();
        }
        return;
      }

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        repo.saveProgress({
          bookId,
          chapterIndex: topItem.chapterIndex,
          charOffset: topItem.blockIndex,
          updatedAt: Date.now(),
        });
      }, PROGRESS_SAVE_DEBOUNCE_MS);
    },
  ).current;

  const currentTitle = useMemo(() => {
    if (!chapters) return '';
    return chapters[currentChapterIndex]?.title ?? book?.title ?? '';
  }, [chapters, currentChapterIndex, book]);

  const bookPercent = useMemo(() => {
    const total = chapters?.length ?? 0;
    return chapterProgressPercent(currentChapterIndex, total) ?? 0;
  }, [chapters, currentChapterIndex]);

  const bookPercentText = useMemo(() => {
    const total = chapters?.length ?? 0;
    const p = chapterProgressPercentPrecise(currentChapterIndex, total);
    return p == null ? null : p.toFixed(1);
  }, [chapters, currentChapterIndex]);

  const tocEntries = useMemo(
    () => (chapters ?? []).map((c) => ({ index: c.index, title: c.title })),
    [chapters],
  );

  const listHeader = useMemo(() => {
    if (lo <= 0) return null;
    return (
      <Pressable
        style={({ pressed }) => [styles.prevButton, pressed && styles.pressed]}
        onPress={loadPreviousChapter}
        disabled={loadingAbove}
      >
        {loadingAbove ? (
          <ActivityIndicator color={rs.theme.subtle} size="small" />
        ) : (
          <Text style={[styles.prevButtonText, { color: rs.theme.subtle }]}>加载上一章</Text>
        )}
      </Pressable>
    );
  }, [lo, loadingAbove, loadPreviousChapter, rs.theme.subtle]);

  const listFooter = useMemo(() => {
    if (!loadingBelow) return null;
    return <ActivityIndicator color={rs.theme.subtle} style={styles.footerSpinner} />;
  }, [loadingBelow, rs.theme.subtle]);

  return (
    <View testID="reader-root" style={[styles.container, rs.container]}>
      {/* Hide the OS status bar so our slim bar owns the top (like 起点). */}
      <StatusBar hidden />
      {loading ? (
        <ActivityIndicator color={rs.theme.subtle} style={styles.centerSpinner} />
      ) : error !== null ? (
        <View style={styles.centerMessage}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <View
          testID="reader-surface"
          style={[styles.surface, restoring && styles.surfaceHidden]}
          onTouchStart={onSurfaceTouchStart}
          onTouchMove={onSurfaceTouchMove}
          onTouchEnd={onSurfaceTouchEnd}
        >
          <FlatList
            ref={listRef}
            data={blocks}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) =>
              item.isTitle ? (
                <Text style={[styles.chapterHeadingSpacing, rs.heading]}>{item.text}</Text>
              ) : (
                <Text style={rs.paragraph}>
                  {PARA_INDENT}
                  {item.text}
                </Text>
              )
            }
            contentContainerStyle={[styles.content, rs.content]}
            ListHeaderComponent={listHeader}
            ListFooterComponent={listFooter}
            onEndReached={loadMoreBelow}
            onEndReachedThreshold={0.6}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: false,
              });
              setTimeout(() => {
                listRef.current?.scrollToIndex({ index: info.index, animated: false });
              }, 50);
            }}
          />
        </View>
      )}

      {/* Slim top bar — always visible, replaces the OS status bar. */}
      {!loading && error === null && (
        <View
          testID="reader-topbar"
          style={[styles.slimBar, { backgroundColor: rs.theme.background, borderBottomColor: rs.theme.border }]}
        >
          <Pressable onPress={onBack} hitSlop={14} style={styles.slimBack}>
            <Text style={[styles.slimArrow, { color: rs.theme.subtle }]}>‹</Text>
          </Pressable>
          <View style={styles.slimTitleGroup}>
            <Text style={[styles.slimTitle, { color: rs.theme.subtle }]} numberOfLines={1}>
              {currentTitle}
            </Text>
            {bookPercentText !== null && (
              <Text style={[styles.slimPct, { color: rs.theme.subtle }]}>
                {' · '}
                {bookPercentText}%
              </Text>
            )}
          </View>
          <View style={styles.slimSpacer} />
          <View style={styles.slimStatus}>
            <Text style={[styles.slimStatusText, { color: rs.theme.subtle }]}>{status.clock}</Text>
            <Text style={[styles.slimStatusText, { color: rs.theme.subtle }]}>{status.battery}</Text>
          </View>
        </View>
      )}

      {chromeVisible && !loading && error === null && (
        <View
          testID="reader-bottombar"
          style={[styles.bottomBar, { backgroundColor: rs.theme.background, borderTopColor: rs.theme.border }]}
        >
          <BarButton label="目录" color={rs.theme.text} onPress={() => setShowToc(true)} />
          <BarButton label="书签" color={rs.theme.text} onPress={openBookmarks} />
          <BarButton
            label="上一章"
            color={rs.theme.text}
            disabled={currentChapterIndex <= 0}
            onPress={() => jumpToChapter(currentChapterIndex - 1)}
          />
          <Pressable testID="progress-jump-open" onPress={() => setShowJump(true)} hitSlop={8}>
            <Text style={[styles.percentText, { color: rs.theme.subtle }]}>{bookPercent}%</Text>
          </Pressable>
          <BarButton
            label="下一章"
            color={rs.theme.text}
            disabled={!!chapters && currentChapterIndex >= chapters.length - 1}
            onPress={() => jumpToChapter(currentChapterIndex + 1)}
          />
          <BarButton label="排版" color={rs.theme.accent} onPress={() => setShowSettings(true)} />
        </View>
      )}

      <ReaderSettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} />
      <TocSheet
        visible={showToc}
        chapters={tocEntries}
        currentIndex={currentChapterIndex}
        onSelect={jumpToChapter}
        onClose={() => setShowToc(false)}
      />
      <ProgressJumpSheet
        visible={showJump}
        chapters={tocEntries}
        currentIndex={currentChapterIndex}
        onJump={jumpToChapter}
        onClose={() => setShowJump(false)}
      />
      <BookmarksSheet
        visible={showBookmarks}
        bookmarks={bookmarks}
        chapterTitles={chapterTitles}
        onAddCurrent={addCurrentBookmark}
        onJump={jumpToBookmark}
        onDelete={deleteBookmark}
        onClose={() => setShowBookmarks(false)}
      />
    </View>
  );
}

interface BarButtonProps {
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}

function BarButton({ label, color, onPress, disabled }: BarButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.barButton, pressed && styles.pressed]}
    >
      <Text style={[styles.barButtonText, { color }, disabled && styles.barButtonDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#15171c' },
  surface: { flex: 1 },
  // Masked while the list settles onto a restored/jumped anchor.
  surfaceHidden: { opacity: 0 },
  // Slim always-on top bar (起点-style): ‹ back · title · % ······ time battery
  slimBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 52,
    paddingBottom: 8,
    paddingHorizontal: 14,
    gap: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  slimBack: { paddingRight: 2 },
  slimArrow: { fontSize: 22, fontWeight: '400', lineHeight: 22, marginTop: -2 },
  slimTitleGroup: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0 },
  slimTitle: { flexShrink: 1, fontSize: 12, fontWeight: '500' },
  slimPct: { fontSize: 11, fontVariant: ['tabular-nums'] },
  slimSpacer: { flex: 1, minWidth: 8 },
  slimStatus: { flexDirection: 'row', gap: 6 },
  slimStatusText: { fontSize: 11.5, fontVariant: ['tabular-nums'] },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 34,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barButton: { paddingVertical: 6, paddingHorizontal: 6 },
  barButtonText: { fontSize: 14, fontWeight: '500' },
  barButtonDisabled: { opacity: 0.35 },
  percentText: { fontSize: 13, minWidth: 44, textAlign: 'center' },
  centerSpinner: { flex: 1 },
  centerMessage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: '#e0a0a0', fontSize: 15, textAlign: 'center' },
  content: { paddingHorizontal: 24, paddingTop: 78, paddingBottom: 48 },
  chapterHeadingSpacing: { fontWeight: '600', marginTop: 28, marginBottom: 16 },
  prevButton: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 20, marginBottom: 12 },
  prevButtonText: { fontSize: 14 },
  pressed: { opacity: 0.6 },
  footerSpinner: { marginVertical: 20 },
});
