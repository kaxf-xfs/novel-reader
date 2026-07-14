/** 增量 8.5: 已读图鉴 Modal 重做——搜索、FlatList/SectionList 虚拟化、卡片式详情、
 * 分组树状关系列表。纪律不变：本组件及其子组件只接收调用方已用 codexForCutoff
 * 过滤过的 codex，永不同时持有裸 codex + cutoff。 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Character, Codex, Term } from '../lib/ai/codex';
import { filterCharacters, filterTerms } from '../lib/ai/codexSearch';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';
import { EgoGraph } from './EgoGraph';
import { RelationRoster } from './RelationRoster';

type CodexTab = 'characters' | 'terms' | 'graph';

export interface CodexModalProps {
  visible: boolean;
  onClose: () => void;
  configured: boolean;
  consented: boolean;
  onOpenSettings: () => void;
  onConsent: () => void;
  codex: Codex;
  complete: boolean;
  versionMismatch: boolean;
  currentChapterLabel: string;
  busy: boolean;
  progress: { done: number; total: number; phase?: 'extract' | 'polish' } | null;
  error: string | null;
  onComplete: () => void;
  onRebuild: () => void;
  onCancel: () => void;
}

export function CodexModal(props: CodexModalProps) {
  const {
    visible, onClose, configured, consented, onOpenSettings, onConsent,
    codex, complete, versionMismatch, currentChapterLabel, busy, progress, error,
    onComplete, onRebuild, onCancel,
  } = props;
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const [tab, setTab] = useState<CodexTab>('characters');
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [charQuery, setCharQuery] = useState('');
  const [termQuery, setTermQuery] = useState('');

  const filteredCharacters = useMemo(() => filterCharacters(codex.characters, charQuery), [codex.characters, charQuery]);
  const filteredTerms = useMemo(() => filterTerms(codex.terms, termQuery), [codex.terms, termQuery]);
  const termSections = useMemo(() => {
    const byCategory = new Map<string, Term[]>();
    for (const t of filteredTerms) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
    return [...byCategory.entries()].map(([category, terms]) => ({ title: category, data: terms }));
  }, [filteredTerms]);

  const selectByName = (name: string) => {
    const found = codex.characters.find((c) => c.name === name);
    if (found) {
      setSelectedCharacter(found);
      setTab('characters');
    }
  };

  const body = () => {
    if (!configured) {
      return (
        <View testID="codex-need-config" style={styles.center}>
          <Text style={[styles.hint, { color: theme.subtle }]}>还没配置 AI。填入 API Key 并打开「启用」开关即可开始。</Text>
          <Pressable testID="codex-open-settings" onPress={onOpenSettings} style={[styles.primary, { backgroundColor: theme.accent }]}>
            <Text style={styles.primaryText}>去设置</Text>
          </Pressable>
        </View>
      );
    }
    if (!consented) {
      return (
        <View testID="codex-consent-gate" style={styles.center}>
          <Text style={[styles.hint, { color: theme.subtle }]}>
            生成图鉴会把「已读」内容的摘要发送到你配置的服务。仅发送到当前阅读进度为止的内容。
          </Text>
          <Pressable testID="codex-consent" onPress={onConsent} style={[styles.primary, { backgroundColor: theme.accent }]}>
            <Text style={styles.primaryText}>同意并继续</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.flex}>
        <View style={styles.tabs}>
          {([['characters', '人物'], ['terms', '世界观'], ['graph', '关系图']] as const).map(([t, label]) => (
            <Pressable
              key={t}
              testID={`codex-tab-${t}`}
              onPress={() => { setTab(t); setSelectedCharacter(null); }}
              style={[styles.tab, { backgroundColor: tab === t ? theme.accent : `${theme.subtle}1f` }]}
            >
              <Text style={[styles.tabText, { color: tab === t ? '#fff' : theme.subtle }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {!complete && (
          <Pressable
            testID="codex-complete"
            onPress={onComplete}
            disabled={busy}
            style={[styles.secondary, { borderColor: theme.accent, opacity: busy ? 0.5 : 1 }]}
          >
            <Text style={[styles.secondaryText, { color: theme.accent }]}>补全到当前进度（{currentChapterLabel}）</Text>
          </Pressable>
        )}
        {versionMismatch && (
          <Pressable testID="codex-rebuild" onPress={onRebuild} disabled={busy} style={[styles.secondary, { borderColor: theme.subtle, opacity: busy ? 0.5 : 1 }]}>
            <Text style={[styles.secondaryText, { color: theme.subtle }]}>重建图鉴</Text>
          </Pressable>
        )}
        {busy && (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
            {progress && (
              <Text testID="codex-progress" style={[styles.hint, { color: theme.subtle }]}>
                {progress.phase === 'polish' ? '整合润色中…' : '正在整理图鉴…'} {progress.done}/{progress.total}
              </Text>
            )}
            <Pressable testID="codex-cancel" onPress={onCancel} hitSlop={10}>
              <Text style={[styles.cancel, { color: theme.subtle }]}>取消</Text>
            </Pressable>
          </View>
        )}
        {error && <Text testID="codex-error" style={[styles.error, { color: '#d9534f' }]}>{error}</Text>}

        <View style={styles.flex}>
          {tab === 'characters' && !selectedCharacter && (
            <View style={styles.flex}>
              <TextInput
                testID="codex-character-search"
                value={charQuery}
                onChangeText={setCharQuery}
                placeholder="搜索人物 / 别名 / 势力"
                placeholderTextColor={theme.subtle}
                style={[styles.search, { color: theme.text, borderColor: theme.border }]}
              />
              <FlatList
                testID="codex-character-list"
                data={filteredCharacters}
                keyExtractor={(c) => c.name}
                renderItem={({ item: c }) => (
                  <Pressable testID={`codex-character-${c.name}`} onPress={() => setSelectedCharacter(c)} style={[styles.listItem, { borderBottomColor: theme.border }]}>
                    <Text style={[styles.listItemText, { color: theme.heading }]}>{c.name}</Text>
                    <Text numberOfLines={1} style={[styles.listItemSubtitle, { color: theme.subtle }]}>
                      {[c.groups[0]?.name, c.bio?.[0]?.text ?? c.identity[0]?.text].filter(Boolean).join(' · ')}
                    </Text>
                  </Pressable>
                )}
              />
            </View>
          )}
          {tab === 'characters' && selectedCharacter && (
            <CharacterDetail
              character={selectedCharacter}
              theme={theme}
              onBack={() => setSelectedCharacter(null)}
              allCharacters={codex.characters}
              relations={codex.relations}
              onSelectCharacter={selectByName}
            />
          )}
          {tab === 'terms' && (
            <View style={styles.flex}>
              <TextInput
                testID="codex-term-search"
                value={termQuery}
                onChangeText={setTermQuery}
                placeholder="搜索词条"
                placeholderTextColor={theme.subtle}
                style={[styles.search, { color: theme.text, borderColor: theme.border }]}
              />
              <SectionList
                testID="codex-term-list"
                sections={termSections}
                keyExtractor={(t) => t.name}
                renderSectionHeader={({ section }) => (
                  <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionLabel, { color: theme.subtle }]}>{section.title}</Text>
                    <View style={[styles.rule, { backgroundColor: theme.border }]} />
                  </View>
                )}
                renderItem={({ item: t }) => {
                  const shown = t.gloss?.[0] ?? t.def[0];
                  return (
                    <View style={[styles.listItem, { borderBottomColor: theme.border }]}>
                      <Text style={[styles.listItemText, { color: theme.heading }]}>{t.name}</Text>
                      {shown && <Text style={[styles.detailLine, { color: theme.subtle }]}>{shown.text}</Text>}
                    </View>
                  );
                }}
              />
            </View>
          )}
          {tab === 'graph' && (
            <View testID="codex-tab-graph-body" style={styles.flex}>
              <RelationRoster characters={codex.characters} relations={codex.relations} onSelectCharacter={selectByName} />
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View testID="codex-modal" style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.heading }]}>已读图鉴</Text>
          <Pressable testID="codex-close" onPress={onClose} hitSlop={10}>
            <Text style={[styles.closeText, { color: theme.subtle }]}>关闭</Text>
          </Pressable>
        </View>
        {body()}
      </View>
    </Modal>
  );
}

function CharacterDetail({
  character, theme, onBack, allCharacters, relations, onSelectCharacter,
}: {
  character: Character;
  theme: ReturnType<typeof resolveTheme>;
  onBack: () => void;
  allCharacters: Character[];
  relations: Codex['relations'];
  onSelectCharacter: (name: string) => void;
}) {
  return (
    <View testID="codex-character-detail" style={styles.flex}>
      <Pressable testID="codex-character-back" onPress={onBack}>
        <Text style={{ color: theme.accent }}>← 返回</Text>
      </Pressable>
      <Text style={[styles.detailTitle, { color: theme.heading }]}>{character.name}</Text>

      {character.aliases.length > 0 && (
        <ChipRow label="别名" items={character.aliases.map((a) => a.text)} theme={theme} />
      )}
      {character.groups.length > 0 && (
        <ChipRow label="势力" items={character.groups.map((g) => g.name)} theme={theme} />
      )}

      {character.bio && character.bio[0] ? (
        <Text style={[styles.detailLine, { color: theme.text }]}>{character.bio[0].text}</Text>
      ) : (
        character.identity.map((i, idx) => (
          <Text key={idx} style={[styles.detailLine, { color: theme.text }]}>{i.text}</Text>
        ))
      )}
      {(character.origin ?? []).map((o, idx) => (
        <Text key={idx} style={[styles.detailLine, { color: theme.subtle }]}>身世：{o.text}</Text>
      ))}
      {(character.events ?? []).length > 0 && (
        <View style={styles.timeline}>
          <Text style={[styles.sectionLabel, { color: theme.subtle }]}>事件线</Text>
          {(character.events ?? []).map((e, idx) => (
            <View key={idx} style={styles.eventRow}>
              <Text style={[styles.detailLine, { color: theme.subtle }]}>·</Text>
              <Text style={[styles.detailLine, { color: theme.text }]}>{e.text}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.sectionLabel, { color: theme.subtle, marginTop: 16 }]}>关系</Text>
      <EgoGraph
        focalName={character.name}
        characters={allCharacters}
        relations={relations}
        width={280}
        height={200}
        onSelectCharacter={onSelectCharacter}
      />
    </View>
  );
}

function ChipRow({ label, items, theme }: { label: string; items: string[]; theme: ReturnType<typeof resolveTheme> }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={[styles.sectionLabel, { color: theme.subtle }]}>{label}</Text>
      <View style={styles.chipRow}>
        {items.map((item) => (
          <View key={item} style={[styles.chip, { backgroundColor: `${theme.accent}22` }]}>
            <Text style={[styles.chipText, { color: theme.accent }]}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: 22, paddingTop: 50 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '700' },
  closeText: { fontSize: 14, fontWeight: '600' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 14 },
  hint: { fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 9 },
  tabText: { fontSize: 13.5, fontWeight: '600' },
  primary: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondary: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 10, alignItems: 'center', marginBottom: 10 },
  secondaryText: { fontSize: 13.5, fontWeight: '600' },
  cancel: { fontSize: 13, textDecorationLine: 'underline' },
  error: { fontSize: 14, marginBottom: 12, textAlign: 'center' },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10 },
  listItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  listItemText: { fontSize: 15, fontWeight: '600' },
  listItemSubtitle: { fontSize: 12.5, marginTop: 2 },
  sectionHeader: { paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  detailTitle: { fontSize: 20, fontWeight: '700', marginVertical: 12 },
  detailLine: { fontSize: 14.5, lineHeight: 22, marginBottom: 6 },
  timeline: { marginTop: 8, marginBottom: 8 },
  eventRow: { flexDirection: 'row', gap: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12 },
});
