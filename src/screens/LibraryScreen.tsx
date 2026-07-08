/**
 * T4/T6/T8: LibraryScreen — the bookshelf.
 *
 * Light "起点-style" shelf with two switchable layouts (persisted):
 *  - hero  (default): a "继续阅读" card for the most-recently-read book,
 *    followed by a clean list of the rest.
 *  - cards: every book as a floating card with a progress bar.
 *
 * Import (top-right) adds a .txt; long-press a book for a 重命名/删除 menu.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { importBook } from '../lib/import/importBook';
import type { FileGateway } from '../lib/import/importBook';
import type { BookRecord, BookRepository } from '../lib/import/repository';
import { chapterProgressPercent } from '../lib/reader/progress';
import { buildCover } from '../lib/library/cover';
import { sortByRecent } from '../lib/library/sort';
import { selectHero } from '../lib/library/hero';
import { formatRelativeTime } from '../lib/library/time';
import type { LibraryLayout } from '../lib/settings/settings';
import { useSettings } from '../settings/SettingsContext';
import { RenameBookModal } from '../library/RenameBookModal';

interface LibraryScreenProps {
  repo: BookRepository;
  fs: FileGateway;
  onOpenBook: (bookId: string) => void;
  onOpenStats: () => void;
}

interface BookListItem {
  book: BookRecord;
  totalChapters: number;
  progressPercent: number | null;
  importedAt: number;
  lastReadAt: number | null;
  currentChapterTitle: string | null;
}

async function loadLibraryItems(repo: BookRepository): Promise<BookListItem[]> {
  const books = await repo.listBooks();
  const items = await Promise.all(
    books.map(async (book) => {
      const [chapters, progress] = await Promise.all([
        repo.getChapters(book.id),
        repo.getProgress(book.id),
      ]);
      const totalChapters = chapters.length;
      const progressPercent = progress
        ? chapterProgressPercent(progress.chapterIndex, totalChapters)
        : chapterProgressPercent(0, totalChapters);
      const idx = progress ? Math.min(progress.chapterIndex, Math.max(totalChapters - 1, 0)) : 0;
      return {
        book,
        totalChapters,
        progressPercent,
        importedAt: book.importedAt,
        lastReadAt: progress ? progress.updatedAt : null,
        currentChapterTitle: progress ? chapters[idx]?.title ?? null : null,
      };
    }),
  );
  return sortByRecent(items);
}

function progressLabel(item: BookListItem): string {
  if (item.progressPercent === null) return '未分章';
  if (item.lastReadAt === null) return '未读';
  return `已读 ${item.progressPercent}%`;
}

export function LibraryScreen({ repo, fs, onOpenBook, onOpenStats }: LibraryScreenProps) {
  const { settings, update } = useSettings();
  const layout = settings.libraryLayout;

  const [items, setItems] = useState<BookListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingBook, setRenamingBook] = useState<BookRecord | null>(null);

  const reload = useCallback(async () => {
    setLoadingList(true);
    try {
      setItems(await loadLibraryItems(repo));
    } finally {
      setLoadingList(false);
    }
  }, [repo]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleBookMenu = useCallback(
    (book: BookRecord) => {
      Alert.alert(book.title, undefined, [
        { text: '重命名', onPress: () => setRenamingBook(book) },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            await repo.deleteBook(book.id);
            await reload();
          },
        },
        { text: '取消', style: 'cancel' },
      ]);
    },
    [repo, reload],
  );

  const handleRenameSave = useCallback(
    async (title: string) => {
      if (renamingBook) {
        await repo.updateBookTitle(renamingBook.id, title);
        await reload();
      }
      setRenamingBook(null);
    },
    [renamingBook, repo, reload],
  );

  const handleImport = useCallback(async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'public.plain-text'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      setImporting(true);
      await importBook(asset.uri, asset.name, { fs, repo });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败，请重试');
    } finally {
      setImporting(false);
    }
  }, [fs, repo, reload]);

  const heroSplit = useMemo(() => selectHero(items), [items]);

  const openBook = useCallback((b: BookRecord) => onOpenBook(b.id), [onOpenBook]);

  const renderRow = useCallback(
    ({ item }: { item: BookListItem }) => {
      const cover = buildCover(item.book.title);
      return (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          onPress={() => openBook(item.book)}
          onLongPress={() => handleBookMenu(item.book)}
          delayLongPress={400}
        >
          <View style={[styles.rowCover, { backgroundColor: cover.background }]}>
            <Text style={[styles.rowCoverLabel, { color: cover.textColor }]} numberOfLines={2}>
              {cover.label}
            </Text>
          </View>
          <View style={styles.rowInfo}>
            <Text testID="book-title" style={styles.rowTitle} numberOfLines={1}>
              {item.book.title}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {item.totalChapters > 0 ? `共 ${item.totalChapters} 章` : '未分章'}
              {item.lastReadAt !== null ? ` · ${formatRelativeTime(item.lastReadAt)}` : ' · 未读'}
            </Text>
          </View>
          <Text style={item.lastReadAt !== null ? styles.rowPct : styles.rowPctIdle}>
            {item.lastReadAt !== null && item.progressPercent !== null ? `${item.progressPercent}%` : '·'}
          </Text>
        </Pressable>
      );
    },
    [openBook, handleBookMenu],
  );

  const renderCard = useCallback(
    ({ item }: { item: BookListItem }) => {
      const cover = buildCover(item.book.title);
      const pct = item.progressPercent ?? 0;
      return (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          onPress={() => openBook(item.book)}
          onLongPress={() => handleBookMenu(item.book)}
          delayLongPress={400}
        >
          <View style={[styles.cardCover, { backgroundColor: cover.background }]}>
            <Text style={[styles.cardCoverLabel, { color: cover.textColor }]} numberOfLines={2}>
              {cover.label}
            </Text>
          </View>
          <View style={styles.cardInfo}>
            <Text testID="book-title" style={styles.cardTitle} numberOfLines={1}>
              {item.book.title}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {progressLabel(item)}
              {item.lastReadAt !== null ? ` · ${formatRelativeTime(item.lastReadAt)}` : ''}
            </Text>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${pct}%` }]} />
            </View>
          </View>
        </Pressable>
      );
    },
    [openBook, handleBookMenu],
  );

  const heroHeader = useMemo(() => {
    const hero = heroSplit.hero;
    return (
      <View>
        {hero && (
          <Pressable
            style={({ pressed }) => [styles.hero, pressed && styles.pressedSoft]}
            onPress={() => openBook(hero.book)}
            onLongPress={() => handleBookMenu(hero.book)}
            delayLongPress={400}
          >
            <View style={[styles.heroCover, { backgroundColor: buildCover(hero.book.title).background }]}>
              <Text
                style={[styles.heroCoverLabel, { color: buildCover(hero.book.title).textColor }]}
                numberOfLines={2}
              >
                {buildCover(hero.book.title).label}
              </Text>
            </View>
            <View style={styles.heroInfo}>
              <Text style={styles.heroEyebrow}>继续阅读</Text>
              <Text style={styles.heroTitle} numberOfLines={1}>
                {hero.book.title}
              </Text>
              <Text style={styles.heroChapter} numberOfLines={1}>
                {hero.currentChapterTitle ?? '继续上次阅读'}
              </Text>
              <View style={styles.heroProgWrap}>
                <View style={styles.heroTrack}>
                  <View style={[styles.heroTrackFill, { width: `${hero.progressPercent ?? 0}%` }]} />
                </View>
                <View style={styles.heroProgLabels}>
                  <Text style={styles.heroProgLeft}>已读 {hero.progressPercent ?? 0}%</Text>
                  <Text style={styles.heroProgRight}>共 {hero.totalChapters} 章</Text>
                </View>
              </View>
            </View>
          </Pressable>
        )}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>全部 · {items.length} 本</Text>
          <View style={styles.sectionLine} />
        </View>
      </View>
    );
  }, [heroSplit.hero, items.length, openBook, handleBookMenu]);

  const content = () => {
    if (loadingList) return <ActivityIndicator color={ACCENT} style={styles.loading} />;
    if (items.length === 0) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>书架空空如也</Text>
          <Text style={styles.emptyHint}>点击右上角「导入」添加一本 txt 小说</Text>
        </View>
      );
    }
    if (layout === 'cards') {
      return (
        <FlatList
          data={items}
          keyExtractor={(i) => i.book.id}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
        />
      );
    }
    return (
      <FlatList
        data={heroSplit.rest}
        keyExtractor={(i) => i.book.id}
        renderItem={renderRow}
        ListHeaderComponent={heroHeader}
        contentContainerStyle={styles.list}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>书架</Text>
        <View style={styles.headerRight}>
          <Pressable
            testID="open-stats"
            onPress={onOpenStats}
            hitSlop={10}
            style={({ pressed }) => [styles.statsButton, pressed && styles.pressed]}
          >
            <Text style={styles.statsButtonText}>统计</Text>
          </Pressable>
          <LayoutToggle value={layout} onChange={(l) => update({ libraryLayout: l })} />
          <Pressable
            style={({ pressed }) => [styles.importButton, pressed && styles.pressed]}
            onPress={handleImport}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.importButtonText}>导入</Text>
            )}
          </Pressable>
        </View>
      </View>

      {error !== null && <Text style={styles.error}>{error}</Text>}
      {content()}
      <RenameBookModal
        visible={renamingBook !== null}
        book={renamingBook}
        onSave={handleRenameSave}
        onClose={() => setRenamingBook(null)}
      />
    </View>
  );
}

function LayoutToggle({
  value,
  onChange,
}: {
  value: LibraryLayout;
  onChange: (l: LibraryLayout) => void;
}) {
  return (
    <View style={styles.toggle}>
      {(['hero', 'cards'] as const).map((l) => {
        const active = value === l;
        return (
          <Pressable
            key={l}
            onPress={() => onChange(l)}
            style={[styles.toggleSeg, active && styles.toggleSegActive]}
          >
            <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
              {l === 'hero' ? '续读' : '卡片'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Light "起点" shelf palette ─────────────────────────────────────────────
const LIB_BG = '#f5f4f0';
const SURFACE = '#ffffff';
const INK = '#1f1d19';
const MUTED = '#7c766a';
const FAINT = '#a8a293';
const HAIR = '#eae7df';
const ACCENT = '#2c7a6b';
const ACCENT_SOFT = '#eaf3f0';
const TRACK = '#e7e4db';
const COVER_SERIF = 'Songti SC';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: LIB_BG, paddingTop: 64 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  title: { color: INK, fontSize: 28, fontWeight: '700', letterSpacing: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggle: { flexDirection: 'row', backgroundColor: '#eceae3', borderRadius: 9, padding: 2 },
  toggleSeg: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 7 },
  toggleSegActive: {
    backgroundColor: SURFACE,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  toggleText: { fontSize: 12.5, color: MUTED, fontWeight: '600' },
  toggleTextActive: { color: ACCENT },
  statsButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#eceae3' },
  statsButtonText: { fontSize: 12.5, color: MUTED, fontWeight: '600' },
  importButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    minWidth: 58,
    alignItems: 'center',
  },
  importButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  error: { color: '#b23b2e', paddingHorizontal: 20, marginBottom: 8, fontSize: 13 },
  loading: { marginTop: 60 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 },
  emptyText: { color: MUTED, fontSize: 18, marginBottom: 8 },
  emptyHint: { color: FAINT, fontSize: 13 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  pressed: { opacity: 0.65 },
  pressedSoft: { opacity: 0.9 },

  // hero
  hero: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: ACCENT_SOFT,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cfe3dd',
  },
  heroCover: {
    width: 72,
    height: 96,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  heroCoverLabel: { fontFamily: COVER_SERIF, fontSize: 22, fontWeight: '600', letterSpacing: 2, textAlign: 'center' },
  heroInfo: { flex: 1, minWidth: 0, justifyContent: 'center' },
  heroEyebrow: { color: ACCENT, fontSize: 10.5, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  heroTitle: { color: INK, fontSize: 18, fontWeight: '600', marginTop: 5 },
  heroChapter: { color: MUTED, fontSize: 12, marginTop: 2 },
  heroProgWrap: { marginTop: 12 },
  heroTrack: { height: 4, borderRadius: 3, backgroundColor: '#d5e6e1', overflow: 'hidden' },
  heroTrackFill: { height: 4, borderRadius: 3, backgroundColor: ACCENT },
  heroProgLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  heroProgLeft: { color: ACCENT, fontSize: 11, fontWeight: '600' },
  heroProgRight: { color: MUTED, fontSize: 11 },

  // section
  section: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  sectionLabel: { color: FAINT, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  sectionLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: HAIR },

  // list row (hero layout)
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIR },
  rowCover: { width: 44, height: 59, borderRadius: 6, alignItems: 'center', justifyContent: 'center', padding: 6 },
  rowCoverLabel: { fontFamily: COVER_SERIF, fontSize: 14, fontWeight: '600', letterSpacing: 1, textAlign: 'center' },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitle: { color: INK, fontSize: 14.5, fontWeight: '600' },
  rowMeta: { color: MUTED, fontSize: 11.5, marginTop: 4 },
  rowPct: { color: ACCENT, fontSize: 13, fontWeight: '700' },
  rowPctIdle: { color: FAINT, fontSize: 13, fontWeight: '700' },

  // card (cards layout)
  card: {
    flexDirection: 'row',
    gap: 13,
    alignItems: 'center',
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  cardCover: { width: 50, height: 67, borderRadius: 7, alignItems: 'center', justifyContent: 'center', padding: 7 },
  cardCoverLabel: { fontFamily: COVER_SERIF, fontSize: 15, fontWeight: '600', letterSpacing: 1, textAlign: 'center' },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTitle: { color: INK, fontSize: 15, fontWeight: '600' },
  cardMeta: { color: MUTED, fontSize: 11.5, marginTop: 4 },
  track: { height: 3, borderRadius: 2, backgroundColor: TRACK, overflow: 'hidden', marginTop: 9 },
  trackFill: { height: 3, borderRadius: 2, backgroundColor: ACCENT },
});
