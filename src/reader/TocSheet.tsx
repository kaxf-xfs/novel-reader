/**
 * T7: table-of-contents sheet — a full-height modal listing every chapter with
 * a search box. Tapping a chapter jumps the reader there. Follows the current
 * reading theme.
 */

import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { filterChapters, type TocEntry } from '../lib/reader/toc';
import type { SearchOutcome } from '../lib/reader/searchBook';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';
import { FullTextPanel } from './FullTextPanel';

interface TocSheetProps {
  visible: boolean;
  chapters: TocEntry[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  onFullTextSearch?: (term: string) => Promise<SearchOutcome>;
  onSelectResult?: (chapterIndex: number, blockIndex: number, term: string) => void;
}

export function TocSheet({
  visible,
  chapters,
  currentIndex,
  onSelect,
  onClose,
  onFullTextSearch,
  onSelectResult,
}: TocSheetProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'chapter' | 'fulltext'>('chapter');
  const hasFullText = onFullTextSearch != null;

  const filtered = useMemo(() => filterChapters(chapters, query), [chapters, query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View testID="toc-sheet" style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.heading }]}>目录</Text>
        </View>

        {hasFullText && (
          <View style={[styles.tabs, { borderColor: theme.border }]}>
            {(['chapter', 'fulltext'] as const).map((m) => {
              const on = mode === m;
              return (
                <Pressable
                  key={m}
                  style={[styles.tab, on && { backgroundColor: theme.accent }]}
                  onPress={() => setMode(m)}
                >
                  <Text style={[styles.tabText, { color: on ? theme.background : theme.subtle }]}>
                    {m === 'chapter' ? '章节' : '全文'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {mode === 'chapter' ? (
          <>
            <TextInput
              style={[styles.search, { color: theme.text, borderColor: theme.border }]}
              placeholder="搜索章节"
              placeholderTextColor={theme.subtle}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />

            <FlatList
              style={styles.list}
              data={filtered}
              keyExtractor={(item) => `${item.index}`}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={20}
              getItemLayout={(_, i) => ({ length: 48, offset: 48 * i, index: i })}
              renderItem={({ item }) => {
                const active = item.index === currentIndex;
                return (
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    onPress={() => {
                      onSelect(item.index);
                      onClose();
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.rowText,
                        { color: active ? theme.accent : theme.text },
                        active && styles.rowActive,
                      ]}
                    >
                      {item.title}
                    </Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: theme.subtle }]}>没有匹配的章节</Text>
              }
            />
          </>
        ) : (
          <FullTextPanel
            onSearch={onFullTextSearch!}
            onSelectResult={(c, b, t) => {
              onSelectResult?.(c, b, t);
              onClose();
            }}
          />
        )}

        <Pressable
          style={({ pressed }) => [
            styles.closeBar,
            { borderTopColor: theme.border },
            pressed && styles.pressed,
          ]}
          onPress={onClose}
        >
          <Text style={[styles.closeBarText, { color: theme.text }]}>关闭</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, fontWeight: '600' },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 2,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8 },
  tabText: { fontSize: 13.5, fontWeight: '600' },
  search: {
    marginHorizontal: 20,
    marginVertical: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    fontSize: 15,
  },
  list: { flex: 1 },
  row: { height: 48, justifyContent: 'center', paddingHorizontal: 22 },
  pressed: { opacity: 0.6 },
  rowText: { fontSize: 15 },
  rowActive: { fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  closeBar: {
    paddingVertical: 16,
    paddingBottom: 34,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  closeBarText: { fontSize: 16, fontWeight: '600' },
});
