/**
 * 增量 4: StatsScreen — 极简卡片流「阅读统计」页。
 * 主题自适应（resolveTheme），竖向滚动、一卡一概念。
 */

import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
      buckets: dailyBuckets(sessions, now, 14),
      topTitle,
      topMs,
      topPct: total > 0 ? Math.round((topMs / total) * 100) : 0,
    };
    // now intentionally excluded — computed once per render is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, books]);

  const maxBucket = Math.max(1, ...stats.buckets);
  const soft = `${theme.accent}24`; // ~14% alpha (accent is #rrggbb)

  return (
    <View testID="stats-screen" style={[styles.container, { backgroundColor: theme.background }]}>
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
        <ScrollView contentContainerStyle={styles.scroll}>
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

          {/* 连续阅读 + 14 天柱状 */}
          <View style={[styles.card, { backgroundColor: soft }]}>
            <Text style={[styles.k, { color: theme.subtle }]}>连续阅读</Text>
            <Text style={[styles.midV, { color: theme.accent }]}>{stats.streak} 天</Text>
            <Text style={[styles.sub, { color: theme.subtle }]}>
              最长 {stats.longest} 天 · 活跃 {stats.active} 天
            </Text>
            <View style={styles.spark}>
              {stats.buckets.map((v, i) => (
                <View
                  key={i}
                  style={[
                    styles.sparkBar,
                    { height: `${Math.max(6, (v / maxBucket) * 100)}%`, backgroundColor: theme.accent },
                  ]}
                />
              ))}
            </View>
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
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 64 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 28, lineHeight: 30 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  scroll: { paddingHorizontal: 18, paddingBottom: 48, gap: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80, paddingHorizontal: 40 },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  card: { borderRadius: 18, padding: 20 },
  row: { flexDirection: 'row', gap: 12 },
  mini: { flex: 1 },
  k: { fontSize: 12, fontWeight: '600' },
  hero: { fontSize: 40, fontWeight: '800', marginTop: 6, letterSpacing: -0.5 },
  sub: { fontSize: 12, marginTop: 8 },
  miniV: { fontSize: 26, fontWeight: '700', marginTop: 6 },
  midV: { fontSize: 30, fontWeight: '800', marginTop: 6 },
  book: { fontSize: 22, fontWeight: '700', marginTop: 6 },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 40, marginTop: 14 },
  sparkBar: { flex: 1, borderRadius: 2, minHeight: 3 },
});
