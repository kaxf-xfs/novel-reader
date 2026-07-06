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
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

interface TocSheetProps {
  visible: boolean;
  chapters: TocEntry[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

export function TocSheet({ visible, chapters, currentIndex, onSelect, onClose }: TocSheetProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => filterChapters(chapters, query), [chapters, query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View testID="toc-sheet" style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.heading }]}>目录</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.close, { color: theme.subtle }]}>关闭</Text>
          </Pressable>
        </View>

        <TextInput
          style={[styles.search, { color: theme.text, borderColor: theme.border }]}
          placeholder="搜索章节"
          placeholderTextColor={theme.subtle}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />

        <FlatList
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
                    { color: active ? theme.heading : theme.text },
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
  close: { fontSize: 15 },
  search: {
    marginHorizontal: 20,
    marginVertical: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    fontSize: 15,
  },
  row: { height: 48, justifyContent: 'center', paddingHorizontal: 22 },
  pressed: { opacity: 0.6 },
  rowText: { fontSize: 15 },
  rowActive: { fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
});
