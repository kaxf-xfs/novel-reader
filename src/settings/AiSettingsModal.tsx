/** 增量 5: AI 配置弹窗——baseUrl / key（保密）/ model / 启用，本地保存 + 同意说明。 */
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { DEFAULT_AI_CONFIG } from '../lib/ai/config';
import { resolveTheme } from '../lib/settings/styles';
import { useAiConfig } from './AiConfigContext';
import { useSettings } from './SettingsContext';

export function AiSettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const { aiConfig, update } = useAiConfig();

  const [baseUrl, setBaseUrl] = useState(aiConfig.baseUrl);
  const [apiKey, setApiKey] = useState(aiConfig.apiKey);
  const [model, setModel] = useState(aiConfig.model);
  const [enabled, setEnabled] = useState(aiConfig.enabled);
  const [recapEnabled, setRecapEnabled] = useState(aiConfig.recapEnabled);
  const [recapGap, setRecapGap] = useState(String(aiConfig.recapGapDays));
  const [autoSummarize, setAutoSummarize] = useState(aiConfig.autoSummarize);

  // Resync from the persisted config only on the opening edge (closed -> open),
  // not on every render where `visible` stays true. `aiConfig` gets a fresh
  // object identity whenever the provider's background load settles (e.g. its
  // initial async read resolving *while the sheet is already open and being
  // edited) — resyncing on every such change would silently wipe in-progress
  // edits out from under the user before they hit save.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setBaseUrl(aiConfig.baseUrl);
      setApiKey(aiConfig.apiKey);
      setModel(aiConfig.model);
      setEnabled(aiConfig.enabled);
      setRecapEnabled(aiConfig.recapEnabled);
      setRecapGap(String(aiConfig.recapGapDays));
      setAutoSummarize(aiConfig.autoSummarize);
    }
    wasVisible.current = visible;
  }, [visible, aiConfig]);

  const save = () => {
    const parsed = parseInt(recapGap, 10);
    const recapGapDays = Number.isNaN(parsed) ? 7 : Math.min(90, Math.max(0, parsed));
    update({ baseUrl, apiKey, model, enabled, recapEnabled, recapGapDays, autoSummarize });
    onClose();
  };

  const input = [styles.input, { color: theme.text, borderColor: theme.border }];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View testID="ai-settings" style={[styles.sheet, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.heading }]}>AI 设置</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            <Text style={[styles.label, { color: theme.subtle }]}>服务地址（OpenAI 兼容）</Text>
            <TextInput testID="ai-base-url" style={input} value={baseUrl} onChangeText={setBaseUrl}
              placeholder={DEFAULT_AI_CONFIG.baseUrl} placeholderTextColor={theme.subtle} autoCapitalize="none" autoCorrect={false} />

            <Text style={[styles.label, { color: theme.subtle }]}>API Key</Text>
            <TextInput testID="ai-api-key" style={input} value={apiKey} onChangeText={setApiKey}
              placeholder="sk-…" placeholderTextColor={theme.subtle} secureTextEntry autoCapitalize="none" autoCorrect={false} />

            <Text style={[styles.label, { color: theme.subtle }]}>模型</Text>
            <TextInput testID="ai-model" style={input} value={model} onChangeText={setModel}
              placeholder={DEFAULT_AI_CONFIG.model} placeholderTextColor={theme.subtle} autoCapitalize="none" autoCorrect={false} />

            {/* testID lives on the row Pressable (not the bare Switch): RNTL's
                fireEvent.press resolves to an `onPress` prop, which the native
                Switch host component doesn't expose — only `onValueChange`/`onChange`.
                Wrapping the row keeps it testable and, as a bonus, lets users
                toggle by tapping the label too. */}
            <Pressable testID="ai-enable" onPress={() => setEnabled((v) => !v)} style={styles.row}>
              <Text style={[styles.label, { color: theme.text, marginBottom: 0 }]}>启用 AI 伴读</Text>
              <Switch value={enabled} onValueChange={setEnabled} />
            </Pressable>

            <Pressable testID="ai-recap-enable" onPress={() => setRecapEnabled((v) => !v)} style={styles.row}>
              <Text style={[styles.label, { color: theme.text, marginBottom: 0 }]}>久别续读时弹前情回顾</Text>
              <Switch value={recapEnabled} onValueChange={setRecapEnabled} />
            </Pressable>
            <Text style={[styles.label, { color: theme.subtle }]}>隔多少天没读才回顾</Text>
            <TextInput testID="ai-recap-gap" style={input} value={recapGap} onChangeText={setRecapGap}
              placeholder="7" placeholderTextColor={theme.subtle} keyboardType="number-pad" />

            <Pressable testID="ai-auto-summarize" onPress={() => setAutoSummarize((v) => !v)} style={styles.row}>
              <Text style={[styles.label, { color: theme.text, marginBottom: 0 }]}>自动整理已读章节（后台，消耗 API）</Text>
              <Switch value={autoSummarize} onValueChange={setAutoSummarize} />
            </Pressable>

            <Text style={[styles.note, { color: theme.subtle }]}>
              启用后，正文与章节小结会发送到你配置的 AI 服务。API Key 仅保存在本机。
            </Text>

            <Pressable testID="ai-save" onPress={save} style={[styles.save, { backgroundColor: theme.accent }]}>
              <Text style={styles.saveText}>保存</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  // Bottom sheet as the flex-end child of a KeyboardAvoidingView (not absolutely
  // positioned) so it lifts above the on-screen keyboard; a maxHeight + inner
  // ScrollView keep every field (incl. 保存) reachable on short screens.
  sheet: { maxHeight: '88%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 22, paddingTop: 22 },
  scroll: { paddingBottom: 40 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 12.5, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  note: { fontSize: 12, lineHeight: 18, marginTop: 14 },
  save: { marginTop: 20, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
