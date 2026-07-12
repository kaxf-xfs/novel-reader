/** 增量 8: 已读图鉴 Modal（人物/世界观/关系图三 tab）。仿 AiPanel 的全屏 Modal + 门控。
 * 纪律：本组件及其子组件只接收调用方已用 codexForCutoff 过滤过的 codex，
 * 永不同时持有裸 codex + cutoff——过滤只在 ReaderScreen 的边界处发生一次。 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Character, Codex } from '../lib/ai/codex';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';
import { RelationshipGraph } from './RelationshipGraph';

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
  currentChapterNumber: number;
  busy: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  onComplete: () => void;
  onRebuild: () => void;
  onCancel: () => void;
}

export function CodexModal(props: CodexModalProps) {
  const {
    visible, onClose, configured, consented, onOpenSettings, onConsent,
    codex, complete, versionMismatch, currentChapterNumber, busy, progress, error,
    onComplete, onRebuild, onCancel,
  } = props;
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const [tab, setTab] = useState<CodexTab>('characters');
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);

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
              style={[styles.tab, tab === t && { backgroundColor: theme.accent }]}
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
            <Text style={[styles.secondaryText, { color: theme.accent }]}>补全到当前进度（第{currentChapterNumber}章）</Text>
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
                正在整理图鉴… {progress.done}/{progress.total}
              </Text>
            )}
            <Pressable testID="codex-cancel" onPress={onCancel} hitSlop={10}>
              <Text style={[styles.cancel, { color: theme.subtle }]}>取消</Text>
            </Pressable>
          </View>
        )}
        {error && <Text testID="codex-error" style={[styles.error, { color: '#d9534f' }]}>{error}</Text>}

        <ScrollView style={styles.flex}>
          {tab === 'characters' && !selectedCharacter && (
            <View testID="codex-character-list">
              {codex.characters.map((c) => (
                <Pressable key={c.name} testID={`codex-character-${c.name}`} onPress={() => setSelectedCharacter(c)} style={styles.listItem}>
                  <Text style={[styles.listItemText, { color: theme.text }]}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {tab === 'characters' && selectedCharacter && (
            <View testID="codex-character-detail">
              <Pressable testID="codex-character-back" onPress={() => setSelectedCharacter(null)}>
                <Text style={{ color: theme.accent }}>← 返回</Text>
              </Pressable>
              <Text style={[styles.detailTitle, { color: theme.heading }]}>{selectedCharacter.name}</Text>
              {selectedCharacter.identity.map((i, idx) => (
                <Text key={idx} style={[styles.detailLine, { color: theme.text }]}>{i.text}</Text>
              ))}
              {(selectedCharacter.origin ?? []).map((o, idx) => (
                <Text key={idx} style={[styles.detailLine, { color: theme.subtle }]}>身世：{o.text}</Text>
              ))}
            </View>
          )}
          {tab === 'terms' && (
            <View testID="codex-term-list">
              {codex.terms.map((t) => (
                <View key={t.name} style={styles.listItem}>
                  <Text style={[styles.listItemText, { color: theme.text }]}>【{t.category}】{t.name}</Text>
                  {t.def[0] && <Text style={[styles.detailLine, { color: theme.subtle }]}>{t.def[0].text}</Text>}
                </View>
              ))}
            </View>
          )}
          {tab === 'graph' && (
            <View testID="codex-tab-graph-body">
              <RelationshipGraph
                characters={codex.characters}
                relations={codex.relations}
                width={320}
                height={420}
                onSelectCharacter={(name) => {
                  const found = codex.characters.find((c) => c.name === name);
                  if (found) {
                    setSelectedCharacter(found);
                    setTab('characters');
                  }
                }}
              />
            </View>
          )}
        </ScrollView>
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
  listItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.2)' },
  listItemText: { fontSize: 15, fontWeight: '600' },
  detailTitle: { fontSize: 20, fontWeight: '700', marginVertical: 12 },
  detailLine: { fontSize: 14.5, lineHeight: 22, marginBottom: 6 },
});
