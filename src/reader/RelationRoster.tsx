/** 增量 8.5: 关系图 tab 的新内容——按势力分组的树状/标签列表，替代整体网状图。 */
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';

import type { Character, Relation } from '../lib/ai/codex';
import { buildGroupedRoster, type RosterNode } from '../lib/ai/codexRelations';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

export interface RelationRosterProps {
  characters: Character[];
  relations: Relation[];
  onSelectCharacter: (name: string) => void;
}

export function RelationRoster({ characters, relations, onSelectCharacter }: RelationRosterProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const sections = buildGroupedRoster(characters, relations);

  return (
    <SectionList
      testID="relation-roster"
      sections={sections.map((s) => ({ title: s.group, data: s.nodes }))}
      keyExtractor={(node) => node.name}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { color: theme.subtle }]}>{section.title}</Text>
          <View style={[styles.rule, { backgroundColor: theme.border }]} />
        </View>
      )}
      renderItem={({ item }) => <RosterRow node={item} theme={theme} onSelectCharacter={onSelectCharacter} />}
    />
  );
}

function RosterRow({
  node,
  theme,
  onSelectCharacter,
}: {
  node: RosterNode;
  theme: ReturnType<typeof resolveTheme>;
  onSelectCharacter: (name: string) => void;
}) {
  return (
    <View style={{ paddingLeft: node.depth * 18 }}>
      <Pressable testID={`roster-node-${node.name}`} onPress={() => onSelectCharacter(node.name)} style={styles.row}>
        <Text style={[styles.name, { color: theme.text }]}>{node.name}</Text>
        {node.subtitle && (
          <Text numberOfLines={1} style={[styles.subtitle, { color: theme.subtle }]}>
            {node.subtitle}
          </Text>
        )}
      </Pressable>
      {node.chips.length > 0 && (
        <View style={styles.chipRow}>
          {node.chips.map((chip) => (
            <Pressable
              key={`${node.name}-${chip.otherName}-${chip.kind}`}
              testID={`roster-chip-${node.name}-${chip.otherName}-${chip.kind}`}
              onPress={() => onSelectCharacter(chip.otherName)}
              style={[styles.chip, { backgroundColor: `${theme.accent}22` }]}
            >
              <Text style={[styles.chipText, { color: theme.accent }]}>
                {chip.kind}: {chip.otherName}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  row: { paddingVertical: 8 },
  name: { fontSize: 15, fontWeight: '600' },
  subtitle: { fontSize: 12.5, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12 },
});
