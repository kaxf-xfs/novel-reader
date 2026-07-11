/** 增量 5: AI 伴读面板（底部 Modal）。注入 run 回调驱动；各态：未配置/未同意/进度/生成/结果/错误。 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AiError } from '../lib/ai/client';
import type { AiMode } from '../lib/ai/companion';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

/** 语义错误色（红），独立于阅读主题强调色，深浅底都可读。 */
const ERROR_COLOR = '#d9534f';

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

  const [mode, setMode] = useState<AiMode>('ask');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  // 关闭面板时取消在途请求并清空瞬时状态，下次打开是干净的（不残留上次结果/输入）。
  useEffect(() => {
    if (!visible) {
      abortRef.current?.abort();
      runningRef.current = false;
      setBusy(false);
      setProgress(null);
      setResult(null);
      setError(null);
      setInput('');
    }
  }, [visible]);

  const runMode = async (m: AiMode, text: string) => {
    if (runningRef.current) return; // ref 守卫：防极快双击放行两次
    if ((m === 'ask' || m === 'character') && !text.trim()) return;
    runningRef.current = true;
    setBusy(true);
    setResult(null);
    setError(null);
    setProgress(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const answer = await run({
        mode: m,
        input: text.trim(),
        onProgress: (done, total) => setProgress({ done, total }),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      setResult(answer);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(errorText(e));
    } finally {
      runningRef.current = false;
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
          <Text style={[styles.hint, { color: theme.subtle }]}>还没配置 AI。填入 API Key 并打开「启用」开关即可开始。</Text>
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
        <View style={styles.tabs}>
          {([['recap', '回顾'], ['ask', '问书'], ['character', '人物']] as const).map(([m, label]) => (
            <Pressable
              key={m}
              testID={`ai-tab-${m}`}
              onPress={() => { setMode(m); setResult(null); setError(null); setInput(''); }}
              style={[styles.tab, mode === m && { backgroundColor: theme.accent }]}
            >
              <Text style={[styles.tabText, { color: mode === m ? '#fff' : theme.subtle }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {mode === 'recap' ? (
          <Pressable
            testID="ai-generate"
            onPress={() => runMode('recap', '')}
            disabled={busy}
            style={[styles.primary, { backgroundColor: theme.accent, opacity: busy ? 0.5 : 1 }]}
          >
            <Text style={styles.primaryText}>生成回顾</Text>
          </Pressable>
        ) : (
          <>
            <TextInput
              testID="ai-ask-input"
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              placeholder={mode === 'character' ? '输入人物名…' : '问一个关于已读内容的问题…'}
              placeholderTextColor={theme.subtle}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => runMode(mode, input)}
              editable={!busy}
              returnKeyType="send"
            />
            <Pressable testID="ai-submit" onPress={() => runMode(mode, input)} disabled={busy} style={[styles.primary, { backgroundColor: theme.accent, opacity: busy ? 0.5 : 1 }]}>
              <Text style={styles.primaryText}>{mode === 'character' ? '查人物' : '提问'}</Text>
            </Pressable>
          </>
        )}
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
        {error && <Text testID="ai-error" style={[styles.error, { color: ERROR_COLOR }]}>{error}</Text>}
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
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View testID="ai-panel" style={[styles.sheet, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.heading }]}>AI 伴读</Text>
          {body()}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  // flex-end child of KeyboardAvoidingView (not absolute) so it lifts above the keyboard.
  sheet: { height: '72%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: StyleSheet.hairlineWidth, padding: 22, paddingBottom: 30 },
  flex: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 14 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 14 },
  hint: { fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 9 },
  tabText: { fontSize: 13.5, fontWeight: '600' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  primary: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cancel: { fontSize: 13, textDecorationLine: 'underline' },
  error: { fontSize: 14, marginTop: 16, textAlign: 'center' },
  result: { fontSize: 15.5, lineHeight: 25, marginTop: 16 },
});
