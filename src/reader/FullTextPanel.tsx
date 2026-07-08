/** 增量2: 目录面板「全文」页——搜索框（提交触发）+ 结果列表，主题自适应。 */
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { hexToRgba, splitHighlight } from '../lib/reader/search';
import type { SearchOutcome, SearchResult } from '../lib/reader/searchBook';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

interface FullTextPanelProps {
  onSearch: (term: string) => Promise<SearchOutcome>;
  onSelectResult: (chapterIndex: number, blockIndex: number, term: string) => void;
}

export function FullTextPanel({ onSearch, onSelectResult }: FullTextPanelProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);

  const [query, setQuery] = useState('');
  const [term, setTerm] = useState(''); // the submitted term (for highlighting)
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);

  const submit = async () => {
    const q = query.trim();
    if (!q) return;
    setTerm(q);
    setLoading(true);
    try {
      setOutcome(await onSearch(q));
    } finally {
      setLoading(false);
    }
  };

  const hlBg = hexToRgba(theme.accent, 0.22);

  const renderRow = ({ item }: { item: SearchResult }) => (
    <Pressable
      testID="ft-result"
      style={({ pressed }) => [styles.row, { borderTopColor: theme.border }, pressed && styles.pressed]}
      onPress={() => onSelectResult(item.chapterIndex, item.blockIndex, term)}
    >
      <Text style={[styles.rowChapter, { color: theme.subtle }]} numberOfLines={1}>
        {item.chapterTitle}
      </Text>
      <Text style={[styles.rowSnippet, { color: theme.text }]} numberOfLines={2}>
        {splitHighlight(item.snippet, term).map((seg, i) => (
          <Text key={i} style={seg.match ? { backgroundColor: hlBg } : undefined}>
            {seg.text}
          </Text>
        ))}
      </Text>
    </Pressable>
  );

  return (
    <View testID="fulltext-panel" style={styles.container}>
      <TextInput
        style={[styles.search, { color: theme.text, borderColor: theme.border }]}
        placeholder="搜索全文"
        placeholderTextColor={theme.subtle}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
        returnKeyType="search"
        autoCorrect={false}
      />
      {loading ? (
        <ActivityIndicator color={theme.subtle} style={styles.spinner} />
      ) : outcome === null ? null : outcome.results.length === 0 ? (
        <Text style={[styles.empty, { color: theme.subtle }]}>没有找到</Text>
      ) : (
        <FlatList
          data={outcome.results}
          keyExtractor={(r, i) => `${r.chapterIndex}-${r.blockIndex}-${i}`}
          keyboardShouldPersistTaps="handled"
          renderItem={renderRow}
          ListHeaderComponent={
            <Text style={[styles.meta, { color: theme.subtle }]}>
              找到 {outcome.results.length} 处{outcome.capped ? ' · 仅显示前 300 条' : ''}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  search: {
    marginHorizontal: 20,
    marginVertical: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    fontSize: 15,
  },
  spinner: { marginTop: 30 },
  meta: { paddingHorizontal: 22, paddingBottom: 8, fontSize: 12 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  row: { paddingHorizontal: 22, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth },
  rowChapter: { fontSize: 12, marginBottom: 5 },
  rowSnippet: { fontSize: 14.5, lineHeight: 22 },
  pressed: { opacity: 0.6 },
});
