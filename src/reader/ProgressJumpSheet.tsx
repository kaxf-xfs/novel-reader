/**
 * 增量1: 进度拖动跳转浮层。原生 slider 不在 ipa，故用 RN 内置 PanResponder
 * 自绘轨道。拖动实时预览目标章标题，松手跳转。
 */
import { useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import type { TocEntry } from '../lib/reader/toc';
import { chapterIndexToFraction, fractionToChapterIndex } from '../lib/reader/seek';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

interface ProgressJumpSheetProps {
  visible: boolean;
  chapters: TocEntry[];
  currentIndex: number;
  onJump: (index: number) => void;
  onClose: () => void;
}

export function ProgressJumpSheet({
  visible,
  chapters,
  currentIndex,
  onJump,
  onClose,
}: ProgressJumpSheetProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const total = chapters.length;

  const [previewIndex, setPreviewIndex] = useState(currentIndex);
  const trackWidthRef = useRef(1);
  const trackLeftRef = useRef(0);

  // 每次打开时把预览重置到当前章。
  const openedIndex = useRef(currentIndex);
  if (visible && openedIndex.current !== currentIndex && previewIndex === currentIndex) {
    openedIndex.current = currentIndex;
  }

  const previewRef = useRef(previewIndex);
  previewRef.current = previewIndex;

  const setFromX = (pageX: number) => {
    const f = (pageX - trackLeftRef.current) / trackWidthRef.current;
    setPreviewIndex(fractionToChapterIndex(f, total));
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => setFromX(e.nativeEvent.pageX),
        onPanResponderMove: (e) => setFromX(e.nativeEvent.pageX),
        onPanResponderRelease: () => {
          // previewRef 持有最新预览下标，规避闭包捕获旧值。
          onJump(previewRef.current);
          onClose();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [total],
  );

  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWidthRef.current = Math.max(1, e.nativeEvent.layout.width);
    e.currentTarget.measure?.((_x, _y, _w, _h, px) => {
      trackLeftRef.current = px;
    });
  };

  const fraction = chapterIndexToFraction(previewIndex, total);
  const title = chapters[previewIndex]?.title ?? '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        testID="progress-jump-sheet"
        style={[styles.sheet, { backgroundColor: theme.background, borderTopColor: theme.border }]}
      >
        <Text style={[styles.preview, { color: theme.heading }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.pct, { color: theme.subtle }]}>
          {total > 0 ? Math.round(fraction * 100) : 0}%
        </Text>
        <View
          style={styles.trackHit}
          onLayout={onTrackLayout}
          {...pan.panHandlers}
        >
          <View style={[styles.track, { backgroundColor: theme.border }]}>
            <View
              style={[styles.fill, { backgroundColor: theme.accent, width: `${fraction * 100}%` }]}
            />
            <View
              style={[styles.thumb, { backgroundColor: theme.accent, left: `${fraction * 100}%` }]}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 44,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  preview: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  pct: { fontSize: 13, textAlign: 'center', marginTop: 6, fontVariant: ['tabular-nums'] },
  trackHit: { paddingVertical: 18, marginTop: 10 },
  track: { height: 4, borderRadius: 2, justifyContent: 'center' },
  fill: { height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    marginLeft: -9,
    top: -7,
  },
});
