/**
 * 增量 4: StatsScreen — 极简卡片流「阅读统计」页。
 * 主题自适应（resolveTheme），竖向滚动、一卡一概念。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import type { BookRecord, BookRepository, ReadingSession } from '../lib/import/repository';
import {
  averageDailyMs, activeDays, currentStreak, dailyBuckets, formatDuration,
  longestStreak, perBookMs, thisWeekMs, todayMs, totalMs,
} from '../lib/stats/aggregate';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

interface StatsScreenProps {
  repo: BookRepository;
  onBack: () => void;
}

export function StatsScreen({ repo, onBack }: StatsScreenProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);

  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([repo.listSessions(), repo.listBooks()]).then(([s, b]) => {
      if (cancelled) return;
      setSessions(s);
      setBooks(b);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // 左缘向右滑 → 返回书架（与阅读器手势一致；纯 View 无滚动冲突）。
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches[0];
    if (t) touchStartRef.current = { x: t.pageX, y: t.pageY };
  };
  const onTouchEnd = (e: GestureResponderEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const end = e.nativeEvent.changedTouches[0];
    if (!start || !end) return;
    const dx = end.pageX - start.x;
    const dy = end.pageY - start.y;
    if (start.x < 40 && dx > 60 && dx > Math.abs(dy) * 2) onBack();
  };

  const now = Date.now();
  const stats = useMemo(() => {
    const total = totalMs(sessions);
    const perBook = perBookMs(sessions);
    let topBookId: string | null = null;
    let topMs = 0;
    for (const [id, ms] of perBook) {
      if (ms > topMs) {
        topMs = ms;
        topBookId = id;
      }
    }
    const topTitle = topBookId ? books.find((b) => b.id === topBookId)?.title ?? null : null;
    return {
      total,
      today: todayMs(sessions, now),
      week: thisWeekMs(sessions, now),
      streak: currentStreak(sessions, now),
      longest: longestStreak(sessions),
      active: activeDays(sessions),
      avg: averageDailyMs(sessions),
      buckets: dailyBuckets(sessions, now, 28),
      topTitle,
      topMs,
      topPct: total > 0 ? Math.round((topMs / total) * 100) : 0,
    };
    // now intentionally excluded — computed once per render is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, books]);

  const soft = `${theme.accent}24`; // ~14% alpha (accent is #rrggbb)

  // 热力图配色：空=淡灰，其余按当天时长取强调色三档透明度（RN 接受 #rrggbbaa）。
  const heatColor = (ms: number): string => {
    if (ms <= 0) return `${theme.subtle}22`;
    if (ms < 20 * 60_000) return `${theme.accent}47`;
    if (ms < 60 * 60_000) return `${theme.accent}94`;
    return theme.accent;
  };
  // 最近 4 周 → 4 行(周) × 7 列(天)，buckets[27] 为今天，最下一行为本周。
  const heatRows: number[][] = [];
  for (let w = 0; w < 4; w++) {
    const row: number[] = [];
    for (let d = 0; d < 7; d++) row.push(stats.buckets[w * 7 + d] ?? 0);
    heatRows.push(row);
  }

  return (
    <View
      testID="stats-screen"
      style={[styles.container, { backgroundColor: theme.background }]}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={14} style={styles.back}>
          <Text style={[styles.arrow, { color: theme.subtle }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: theme.heading }]}>阅读统计</Text>
        <View style={styles.back} />
      </View>

      {loaded && sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.subtle }]}>
            开始阅读后，这里会记录你的时间
          </Text>
        </View>
      ) : (
        <View style={styles.flow}>
          {/* hero — 累计总时长 */}
          <View style={[styles.card, { backgroundColor: theme.accent }]}>
            <Text style={[styles.k, { color: '#ffffffb8' }]}>累计阅读</Text>
            <Text testID="stats-hero-total" style={[styles.hero, { color: '#ffffff' }]}>
              {formatDuration(stats.total)}
            </Text>
            <Text style={[styles.sub, { color: '#ffffffcc' }]}>
              日均 {formatDuration(stats.avg)} · 活跃 {stats.active} 天
            </Text>
          </View>

          {/* 今日 · 本周 */}
          <View style={styles.row}>
            <View style={[styles.card, styles.mini, { backgroundColor: soft }]}>
              <Text style={[styles.k, { color: theme.subtle }]}>今日</Text>
              <Text style={[styles.miniV, { color: theme.heading }]}>{formatDuration(stats.today)}</Text>
            </View>
            <View style={[styles.card, styles.mini, { backgroundColor: soft }]}>
              <Text style={[styles.k, { color: theme.subtle }]}>本周</Text>
              <Text style={[styles.miniV, { color: theme.heading }]}>{formatDuration(stats.week)}</Text>
            </View>
          </View>

          {/* 连续阅读 */}
          <View style={[styles.card, { backgroundColor: soft }]}>
            <Text style={[styles.k, { color: theme.subtle }]}>连续阅读</Text>
            <Text style={[styles.midV, { color: theme.accent }]}>{stats.streak} 天</Text>
            <Text style={[styles.sub, { color: theme.subtle }]}>
              最长 {stats.longest} 天 · 活跃 {stats.active} 天
            </Text>
          </View>

          {/* 读得最多 */}
          {stats.topTitle && (
            <View style={[styles.card, { backgroundColor: soft }]}>
              <Text style={[styles.k, { color: theme.subtle }]}>读得最多</Text>
              <Text style={[styles.book, { color: theme.heading }]} numberOfLines={1}>
                {stats.topTitle}
              </Text>
              <Text style={[styles.sub, { color: theme.subtle }]}>
                {formatDuration(stats.topMs)} · 占总时长 {stats.topPct}%
              </Text>
            </View>
          )}

          {/* 最近 4 周热力图 */}
          <View style={[styles.card, { backgroundColor: soft }]}>
            <View style={styles.heatHead}>
              <Text style={[styles.k, { color: theme.subtle }]}>最近 4 周</Text>
              <View style={styles.legend}>
                <Text style={[styles.legendText, { color: theme.subtle }]}>少</Text>
                {[0, 10 * 60_000, 40 * 60_000, 90 * 60_000].map((ms, i) => (
                  <View key={i} style={[styles.legendCell, { backgroundColor: heatColor(ms) }]} />
                ))}
                <Text style={[styles.legendText, { color: theme.subtle }]}>多</Text>
              </View>
            </View>
            <View style={styles.heatGrid}>
              {heatRows.map((row, ri) => (
                <View key={ri} style={styles.heatRow}>
                  {row.map((ms, di) => (
                    <View key={di} style={[styles.heatCell, { backgroundColor: heatColor(ms) }]} />
                  ))}
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 28, lineHeight: 30 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  // flex:1 + space-between 让五块卡片撑满整屏、底部不留白；gap 作为最小间距。
  flow: { flex: 1, paddingHorizontal: 16, paddingBottom: 12, gap: 9, justifyContent: 'space-between' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80, paddingHorizontal: 40 },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  card: { borderRadius: 16, padding: 17 },
  row: { flexDirection: 'row', gap: 9 },
  mini: { flex: 1 },
  k: { fontSize: 11.5, fontWeight: '600' },
  hero: { fontSize: 32, fontWeight: '800', marginTop: 3, letterSpacing: -0.5 },
  sub: { fontSize: 11.5, marginTop: 5 },
  miniV: { fontSize: 22, fontWeight: '700', marginTop: 3 },
  midV: { fontSize: 26, fontWeight: '800', marginTop: 3 },
  book: { fontSize: 19, fontWeight: '700', marginTop: 3 },
  // heatmap
  heatHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendText: { fontSize: 10.5 },
  legendCell: { width: 9, height: 9, borderRadius: 2 },
  heatGrid: { flexDirection: 'column', gap: 4 },
  heatRow: { flexDirection: 'row', gap: 4 },
  heatCell: { flex: 1, aspectRatio: 1, borderRadius: 3 },
});
