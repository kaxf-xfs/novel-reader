/** 增量 6: 阅读页顶部「前情回顾」浮层卡（一次性提示，非 Modal）。 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

/** 语义错误色（红），独立于阅读主题强调色，深浅底都可读。 */
const ERROR_COLOR = '#d9534f';

export type CachedRecapResult = { kind: 'text'; text: string } | { kind: 'needs-generation' };

export interface ResumeRecapCardProps {
  visible: boolean;
  chapterLabel: string;
  /** Actual elapsed days since the reader was last opened (not a config threshold). */
  daysSinceRead: number;
  loadCachedRecap: (signal: AbortSignal) => Promise<CachedRecapResult>;
  generateRecap: (onProgress: (done: number, total: number) => void, signal: AbortSignal) => Promise<string>;
  onDismiss: () => void;
}

type CardState =
  | { phase: 'loading' }
  | { phase: 'needs-generation' }
  | { phase: 'generating'; progress: { done: number; total: number } | null }
  | { phase: 'text'; text: string }
  | { phase: 'error'; message: string };

export function ResumeRecapCard({
  visible,
  chapterLabel,
  daysSinceRead,
  loadCachedRecap,
  generateRecap,
  onDismiss,
}: ResumeRecapCardProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);

  const [state, setState] = useState<CardState>({ phase: 'loading' });
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  // visible → true: 拉取缓存回顾；visible → false / 卸载: abort 在途请求，防
  // setState-after-unmount。
  useEffect(() => {
    if (!visible) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ phase: 'loading' });
    loadCachedRecap(ctrl.signal)
      .then((result) => {
        if (ctrl.signal.aborted) return;
        if (result.kind === 'text') {
          setState({ phase: 'text', text: result.text });
        } else {
          setState({ phase: 'needs-generation' });
        }
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setState({ phase: 'error', message: '加载回顾失败，请重试。' });
      });
    return () => {
      // 用 abortRef.current 而非闭包里的 ctrl：若组件在 generating 阶段被直接卸载
      // （未先经过 visible→false），abortRef.current 此时指向 handleGenerate 建的
      // 新 controller，这样才能真正取消在途的生成请求，而不是 abort 一个早已
      // resolve 的加载 controller（那样会导致生成请求在后台跑完，白烧 API）。
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 回调 identity 不参与依赖，避免重复触发
  }, [visible]);

  const handleGenerate = () => {
    if (runningRef.current) return; // ref 守卫：防极快双击建两个 controller
    runningRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ phase: 'generating', progress: null });
    generateRecap((done, total) => {
      if (ctrl.signal.aborted) return;
      setState({ phase: 'generating', progress: { done, total } });
    }, ctrl.signal)
      .then((text) => {
        if (ctrl.signal.aborted) return;
        setState({ phase: 'text', text });
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setState({ phase: 'error', message: '生成回顾失败，请重试。' });
      })
      .finally(() => {
        runningRef.current = false;
      });
  };

  if (!visible) return null;

  const body = () => {
    switch (state.phase) {
      case 'loading':
        return (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
          </View>
        );
      case 'needs-generation':
        return (
          <Pressable
            testID="recap-generate"
            onPress={handleGenerate}
            style={[styles.primary, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.primaryText}>生成回顾</Text>
          </Pressable>
        );
      case 'generating':
        return (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
            <Text testID="recap-progress" style={[styles.hint, { color: theme.subtle }]}>
              正在整理最近章节… {state.progress ? `${state.progress.done}/${state.progress.total}` : ''}
            </Text>
          </View>
        );
      case 'text':
        return (
          <Text testID="recap-text" style={[styles.text, { color: theme.text }]}>
            {state.text}
          </Text>
        );
      case 'error':
        return (
          <Text testID="recap-error" style={[styles.hint, { color: ERROR_COLOR }]}>{state.message}</Text>
        );
      default:
        return null;
    }
  };

  return (
    <View
      testID="resume-recap-card"
      onStartShouldSetResponder={() => true}
      style={[styles.card, { backgroundColor: theme.background, borderColor: theme.border }]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.subtle }]}>
          读到 {chapterLabel} · 上次阅读是 {daysSinceRead} 天前
        </Text>
        <Pressable testID="recap-dismiss" onPress={onDismiss} hitSlop={10}>
          <Text style={[styles.dismiss, { color: theme.subtle }]}>×</Text>
        </Pressable>
      </View>
      {body()}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    // Clears ReaderScreen's slim top bar (paddingTop 52 + content row ≈ 88
    // tall) so the card never overlaps the back/title/clock row.
    top: 92,
    left: 16,
    right: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    zIndex: 10,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  dismiss: { fontSize: 18, lineHeight: 18, paddingHorizontal: 4 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 8 },
  hint: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  primary: { borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  text: { fontSize: 14.5, lineHeight: 22 },
});
