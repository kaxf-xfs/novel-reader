/**
 * T4: LibraryScreen — lists imported books, lets the user import new .txt
 * files, and navigates into the reader.
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

interface LibraryScreenProps {
  repo: BookRepository;
  fs: FileGateway;
  onOpenBook: (bookId: string) => void;
}

interface BookListItem {
  book: BookRecord;
  totalChapters: number;
  progressPercent: number | null;
}

async function loadLibraryItems(repo: BookRepository): Promise<BookListItem[]> {
  const books = await repo.listBooks();
  return Promise.all(
    books.map(async (book) => {
      const [chapters, progress] = await Promise.all([
        repo.getChapters(book.id),
        repo.getProgress(book.id),
      ]);
      const totalChapters = chapters.length;
      const progressPercent = progress
        ? chapterProgressPercent(progress.chapterIndex, totalChapters)
        : chapterProgressPercent(0, totalChapters);
      return { book, totalChapters, progressPercent };
    }),
  );
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
        <ActivityIndicator color="#8b8f99" style={styles.loading} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>书架空空如也</Text>
          <Text style={styles.emptyHint}>点击右上角「导入」添加一本 txt 小说</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.book.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.bookRow, pressed && styles.pressed]}
              onPress={() => onOpenBook(item.book.id)}
              onLongPress={() => handleDelete(item.book)}
              delayLongPress={400}
            >
              <View style={[styles.cover, { backgroundColor: item.book.coverColor }]} />
              <View style={styles.bookInfo}>
                <Text style={styles.bookTitle} numberOfLines={1}>
                  {item.book.title}
                </Text>
                <Text style={styles.bookMeta}>
                  {item.totalChapters > 0 ? `${item.totalChapters} 章` : '未分章'}
                  {' · '}
                  {item.book.strategy}
                  {item.progressPercent !== null ? ` · ${item.progressPercent}%` : ''}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#15171c', paddingTop: 64 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  title: { color: '#f5f3ee', fontSize: 28, fontWeight: '600', letterSpacing: 1 },
  importButton: {
    backgroundColor: '#f5f3ee',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    minWidth: 64,
    alignItems: 'center',
  },
  pressed: { opacity: 0.7 },
  importButtonText: { color: '#15171c', fontSize: 14, fontWeight: '600' },
  error: { color: '#e0a0a0', paddingHorizontal: 20, marginBottom: 8, fontSize: 13 },
  loading: { marginTop: 60 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 },
  emptyText: { color: '#8b8f99', fontSize: 18, marginBottom: 8 },
  emptyHint: { color: '#4a4e57', fontSize: 13 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  bookRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  cover: { width: 44, height: 60, borderRadius: 6, marginRight: 14 },
  bookInfo: { flex: 1 },
  bookTitle: { color: '#f5f3ee', fontSize: 17, fontWeight: '500', marginBottom: 4 },
  bookMeta: { color: '#8b8f99', fontSize: 13 },
});
