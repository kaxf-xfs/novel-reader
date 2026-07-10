/** 增量 5: AI 伴读面板（底部 Modal）。注入 run 回调驱动；各态：未配置/未同意/进度/生成/结果/错误。 */
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AiError } from '../lib/ai/client';
import type { AiMode } from '../lib/ai/companion';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

export interface AiRunParams {
  mode: AiMode;
  input: string;
  onProgress: (done: number, total: number) => void;
  signal: AbortSignal;
}

export interface AiPanelProps {
  visible: boolean;
  onClose: () => void;
  configured: boolean;
  consented: boolean;
  onOpenSettings: () => void;
  onConsent: () => void;
  run: (p: AiRunParams) => Promise<string>;
}

function errorText(e: unknown): string {
  if (e instanceof AiError) {
    switch (e.kind) {
      case 'no-key': return '还没配置 API Key，请先到 AI 设置填写。';
      case 'cancelled': return '已取消。';
      case 'timeout': return '请求超时，请重试。';
      case 'insufficient-balance': return 'API 余额不足。';
      case 'rate-limited': return '请求过于频繁，请稍后再试。';
      case 'network': return '网络错误，请检查连接。';
      default: return 'AI 请求失败，请重试。';
    }
  }
  return 'AI 请求失败，请重试。';
}

export function AiPanel({ visible, onClose, configured, consented, onOpenSettings, onConsent, run }: AiPanelProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const submit = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setProgress(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const answer = await run({
        mode: 'ask',
        input: q,
        onProgress: (done, total) => setProgress({ done, total }),
        signal: ctrl.signal,
      });
      setResult(answer);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const body = () => {
    if (!configured) {
      return (
        <View testID="ai-need-config" style={styles.center}>
          <Text style={[styles.hint, { color: theme.subtle }]}>还没配置 AI。填入你的 API Key 即可开始。</Text>
          <Pressable testID="ai-open-settings" onPress={onOpenSettings} style={[styles.primary, { backgroundColor: theme.accent }]}>
            <Text style={styles.primaryText}>去设置</Text>
          </Pressable>
        </View>
      );
    }
    if (!consented) {
      return (
        <View testID="ai-consent-gate" style={styles.center}>
          <Text style={[styles.hint, { color: theme.subtle }]}>
            使用 AI 伴读会把「已读」正文与小结发送到你配置的服务。仅发送到当前阅读进度为止的内容。
          </Text>
          <Pressable testID="ai-consent" onPress={onConsent} style={[styles.primary, { backgroundColor: theme.accent }]}>
            <Text style={styles.primaryText}>同意并继续</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.flex}>
        <TextInput
          testID="ai-ask-input"
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          placeholder="问一个关于已读内容的问题…"
          placeholderTextColor={theme.subtle}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={submit}
          editable={!busy}
          returnKeyType="send"
        />
        <Pressable testID="ai-submit" onPress={submit} disabled={busy} style={[styles.primary, { backgroundColor: theme.accent, opacity: busy ? 0.5 : 1 }]}>
          <Text style={styles.primaryText}>提问</Text>
        </Pressable>
        {busy && (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
            {progress && (
              <Text testID="ai-progress" style={[styles.hint, { color: theme.subtle }]}>
                正在整理已读章节… {progress.done}/{progress.total}
              </Text>
            )}
            <Pressable testID="ai-cancel" onPress={cancel} hitSlop={10}>
              <Text style={[styles.cancel, { color: theme.subtle }]}>取消</Text>
            </Pressable>
          </View>
        )}
        {error && <Text testID="ai-error" style={[styles.error, { color: theme.accent }]}>{error}</Text>}
        {result && (
          <ScrollView style={styles.flex}>
            <Text testID="ai-result" style={[styles.result, { color: theme.text }]}>{result}</Text>
          </ScrollView>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View testID="ai-panel" style={[styles.sheet, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.heading }]}>AI 伴读</Text>
        {body()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '72%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: StyleSheet.hairlineWidth, padding: 22, paddingBottom: 30 },
  flex: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 14 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 14 },
  hint: { fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  primary: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cancel: { fontSize: 13, textDecorationLine: 'underline' },
  error: { fontSize: 14, marginTop: 16, textAlign: 'center' },
  result: { fontSize: 15.5, lineHeight: 25, marginTop: 16 },
});
