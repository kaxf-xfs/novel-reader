/**
 * T4/T6: LibraryScreen — the bookshelf. Lists imported books as a 2-column
 * grid of generated covers, sorted most-recently-read first, with per-book
 * progress and last-read time. Import (top-right) adds a .txt; long-press a
 * cover to delete.
 */

import { useCallback, useEffect, useState } from 'react';
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
import { formatRelativeTime } from '../lib/library/time';

interface LibraryScreenProps {
  repo: BookRepository;
  fs: FileGateway;
  onOpenBook: (bookId: string) => void;
}

interface BookListItem {
  book: BookRecord;
  totalChapters: number;
  progressPercent: number | null;
  importedAt: number;
  lastReadAt: number | null;
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
      return {
        book,
        totalChapters,
        progressPercent,
        importedAt: book.importedAt,
        lastReadAt: progress ? progress.updatedAt : null,
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

export function LibraryScreen({ repo, fs, onOpenBook }: LibraryScreenProps) {
  const [items, setItems] = useState<BookListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleDelete = useCallback(
    (book: BookRecord) => {
      Alert.alert('删除这本书？', book.title, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            await repo.deleteBook(book.id);
            await reload();
          },
        },
      ]);
    },
    [repo, reload],
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

  const renderItem = useCallback(
    ({ item }: { item: BookListItem }) => {
      const cover = buildCover(item.book.title);
      const pct = item.progressPercent ?? 0;
      return (
        <Pressable
          style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
          onPress={() => onOpenBook(item.book.id)}
          onLongPress={() => handleDelete(item.book)}
          delayLongPress={400}
        >
          <View style={[styles.cover, { backgroundColor: cover.background }]}>
            <Text style={[styles.coverLabel, { color: cover.textColor }]} numberOfLines={2}>
              {cover.label}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text testID="book-title" style={styles.bookTitle} numberOfLines={2}>
            {item.book.title}
          </Text>
          <Text style={styles.bookMeta} numberOfLines={1}>
            {progressLabel(item)}
          </Text>
          {item.lastReadAt !== null && (
            <Text style={styles.bookSubMeta} numberOfLines={1}>
              {formatRelativeTime(item.lastReadAt)}
            </Text>
          )}
        </Pressable>
      );
    },
    [onOpenBook, handleDelete],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>书架</Text>
        <Pressable
          style={({ pressed }) => [styles.importButton, pressed && styles.pressed]}
          onPress={handleImport}
          disabled={importing}
        >
          {importing ? (
            <ActivityIndicator color="#15171c" size="small" />
          ) : (
            <Text style={styles.importButtonText}>导入</Text>
          )}
        </Pressable>
      </View>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      {loadingList ? (
        <ActivityIndicator color={INK_SUBTLE} style={styles.loading} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>书架空空如也</Text>
          <Text style={styles.emptyHint}>点击右上角「导入」添加一本 txt 小说</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.book.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

const COVER_ASPECT = 3 / 4;

// 墨隐 (Ink & Shadow) — the app frame is a fixed deep-ink look; the reading
// background theme is chosen separately in the reader.
const INK_BG = '#14161b';
const INK_HEADING = '#ece7db';
const INK_SUBTLE = '#7f838d';
const INK_FAINT = '#585c65';
const INK_ACCENT = '#83a99b';
const INK_TRACK = '#24272f';
const COVER_FRAME = 'rgba(242,237,225,0.12)';
const COVER_SERIF = 'Songti SC';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK_BG, paddingTop: 64 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    marginBottom: 22,
  },
  title: { color: INK_HEADING, fontSize: 28, fontWeight: '600', letterSpacing: 2 },
  importButton: {
    backgroundColor: INK_HEADING,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    minWidth: 64,
    alignItems: 'center',
  },
  pressed: { opacity: 0.7 },
  importButtonText: { color: INK_BG, fontSize: 14, fontWeight: '600' },
  error: { color: '#e0a0a0', paddingHorizontal: 22, marginBottom: 8, fontSize: 13 },
  loading: { marginTop: 60 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 },
  emptyText: { color: INK_SUBTLE, fontSize: 18, marginBottom: 8 },
  emptyHint: { color: INK_FAINT, fontSize: 13 },
  list: { paddingHorizontal: 22, paddingBottom: 40 },
  row: { gap: 18 },
  cell: { flex: 1, marginBottom: 24, maxWidth: '50%' },
  cover: {
    width: '100%',
    aspectRatio: COVER_ASPECT,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COVER_FRAME,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  coverLabel: {
    fontFamily: COVER_SERIF,
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: 3,
    lineHeight: 38,
    textAlign: 'center',
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: INK_TRACK,
    marginTop: 11,
    overflow: 'hidden',
  },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: INK_ACCENT },
  bookTitle: { color: INK_HEADING, fontSize: 15, fontWeight: '500', marginTop: 9 },
  bookMeta: { color: INK_SUBTLE, fontSize: 12, marginTop: 3 },
  bookSubMeta: { color: INK_FAINT, fontSize: 11, marginTop: 1 },
});
