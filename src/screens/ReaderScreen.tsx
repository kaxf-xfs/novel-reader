/**
 * T4: ReaderScreen — vertical continuous-scroll reader over a sliding
 * window of chapters (current ± 1 initially), backed by byte-range reads
 * so the whole book is never loaded into memory.
 *
 * Scrolling model (pragmatic choice, see AGENTS.md T4 brief):
 *  - Downward: seamless infinite scroll via FlatList onEndReached, which
 *    appends the next chapter's blocks.
 *  - Upward: a "加载上一章" button at the top of the list prepends the
 *    previous chapter's blocks. `maintainVisibleContentPosition` keeps the
 *    scroll position stable when new items are inserted above the fold, so
 *    in practice this reads as seamless too — but it's driven by an
 *    explicit tap rather than by scroll-position detection, which is more
 *    robust than trying to hook top-of-list events.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';

import type { FileGateway } from '../lib/import/importBook';
import type { BookRecord, BookRepository, ChapterRecord } from '../lib/import/repository';
import { readChapterText } from '../lib/reader/readChapter';
import { splitBlocks } from '../lib/reader/blocks';
import { windowIndices } from '../lib/reader/window';
import { computeReaderStyles } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';
import { ReaderSettingsSheet } from '../settings/ReaderSettingsSheet';

interface ReaderScreenProps {
  repo: BookRepository;
  fs: FileGateway;
  bookId: string;
  onBack: () => void;
}

interface FlatBlockItem {
  key: string;
  chapterIndex: number;
  text: string;
  isTitle: boolean;
}

const WINDOW_RADIUS = 1;
const PROGRESS_SAVE_DEBOUNCE_MS = 800;

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
    text: blockText,
    isTitle: i === 0,
  }));
}

export function ReaderScreen({ repo, fs, bookId, onBack }: ReaderScreenProps) {
  const { settings } = useSettings();
  const rs = useMemo(() => computeReaderStyles(settings), [settings]);
  const [showSettings, setShowSettings] = useState(false);

  const [book, setBook] = useState<BookRecord | null>(null);
  const [chapters, setChapters] = useState<ChapterRecord[] | null>(null);
  const [blocks, setBlocks] = useState<FlatBlockItem[]>([]);
  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(0);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingAbove, setLoadingAbove] = useState(false);
  const [loadingBelow, setLoadingBelow] = useState(false);

  const chapterTextCache = useRef(new Map<number, string>());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const indices = windowIndices(chs.length, startIndex, WINDOW_RADIUS);

        const initialBlocks: FlatBlockItem[] = [];
        for (const idx of indices) {
          const chBlocks = await loadChapterBlocks(
            fs,
            foundBook.normalizedPath,
            chs[idx],
            chapterTextCache.current,
          );
          initialBlocks.push(...chBlocks);
        }
        if (cancelled) return;

        setBook(foundBook);
        setChapters(chs);
        setLo(indices[0]);
        setHi(indices[indices.length - 1]);
        setBlocks(initialBlocks);
        setCurrentChapterIndex(startIndex);
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
  }, [bookId, repo, fs]);

  // Clear any pending debounced save on unmount.
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

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

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length === 0) return;
      const topItem = viewableItems[0].item as FlatBlockItem;
      setCurrentChapterIndex(topItem.chapterIndex);

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        repo.saveProgress({
          bookId,
          chapterIndex: topItem.chapterIndex,
          charOffset: 0,
          updatedAt: Date.now(),
        });
      }, PROGRESS_SAVE_DEBOUNCE_MS);
    },
  ).current;

  const currentTitle = useMemo(() => {
    if (!chapters) return '';
    return chapters[currentChapterIndex]?.title ?? book?.title ?? '';
  }, [chapters, currentChapterIndex, book]);

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
    <View style={[styles.container, rs.container]}>
      <View style={[styles.topBar, { borderBottomColor: rs.theme.border }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Text style={[styles.backText, { color: rs.theme.subtle }]}>‹ 书架</Text>
        </Pressable>
        <Text style={[styles.topBarTitle, { color: rs.theme.heading }]} numberOfLines={1}>
          {currentTitle}
        </Text>
        <Pressable
          onPress={() => setShowSettings(true)}
          hitSlop={12}
          style={styles.gearButton}
        >
          <Text style={[styles.gearText, { color: rs.theme.subtle }]}>Aa</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={rs.theme.subtle} style={styles.centerSpinner} />
      ) : error !== null ? (
        <View style={styles.centerMessage}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={blocks}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) =>
            item.isTitle ? (
              <Text style={[styles.chapterHeadingSpacing, rs.heading]}>{item.text}</Text>
            ) : (
              <Text style={rs.paragraph}>{item.text}</Text>
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
        />
      )}

      <ReaderSettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#15171c' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2d35',
  },
  backButton: { minWidth: 64 },
  gearButton: { minWidth: 64, alignItems: 'flex-end' },
  gearText: { fontSize: 18, fontWeight: '600' },
  backText: { fontSize: 15 },
  topBarTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  centerSpinner: { flex: 1 },
  centerMessage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: '#e0a0a0', fontSize: 15, textAlign: 'center' },
  content: { paddingHorizontal: 24, paddingVertical: 24 },
  chapterHeadingSpacing: {
    fontWeight: '600',
    marginTop: 28,
    marginBottom: 16,
  },
  prevButton: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  prevButtonText: { color: '#8b8f99', fontSize: 14 },
  pressed: { opacity: 0.6 },
  footerSpinner: { marginVertical: 20 },
});
