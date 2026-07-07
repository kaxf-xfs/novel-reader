/** 增量1: 书签列表（复用目录 modal 风格）+ 收藏当前位置 + 回跳 + 删除。 */
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Bookmark } from '../lib/import/repository';
import { formatRelativeTime } from '../lib/library/time';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

interface BookmarksSheetProps {
  visible: boolean;
  bookmarks: Bookmark[];
  chapterTitles: Record<number, string>;
  onAddCurrent: () => void;
  onJump: (chapterIndex: number, blockIndex: number) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function BookmarksSheet({
  visible,
  bookmarks,
  chapterTitles,
  onAddCurrent,
  onJump,
  onDelete,
  onClose,
}: BookmarksSheetProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View testID="bookmarks-sheet" style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.heading }]}>书签</Text>
          <Pressable testID="bookmark-add" onPress={onAddCurrent} hitSlop={10}>
            <Text style={[styles.add, { color: theme.accent }]}>＋ 收藏当前位置</Text>
          </Pressable>
        </View>

        <FlatList
          data={bookmarks}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => {
                onJump(item.chapterIndex, item.blockIndex);
                onClose();
              }}
              onLongPress={() => onDelete(item.id)}
            >
              <Text numberOfLines={1} style={[styles.rowChapter, { color: theme.subtle }]}>
                {chapterTitles[item.chapterIndex] ?? ''} · {formatRelativeTime(item.createdAt)}
              </Text>
              <Text numberOfLines={2} style={[styles.rowSnippet, { color: theme.text }]}>
                {item.snippet}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.subtle }]}>
              还没有书签，点右上角「收藏当前位置」添加
            </Text>
          }
        />

        <Pressable
          style={({ pressed }) => [styles.closeBar, { borderTopColor: theme.border }, pressed && styles.pressed]}
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
  add: { fontSize: 14, fontWeight: '600' },
  row: { paddingHorizontal: 22, paddingVertical: 14 },
  rowChapter: { fontSize: 12, marginBottom: 4 },
  rowSnippet: { fontSize: 15, lineHeight: 22 },
  pressed: { opacity: 0.6 },
  empty: { textAlign: 'center', marginTop: 48, fontSize: 14, paddingHorizontal: 30, lineHeight: 22 },
  closeBar: { paddingVertical: 16, paddingBottom: 34, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  closeBarText: { fontSize: 16, fontWeight: '600' },
});
