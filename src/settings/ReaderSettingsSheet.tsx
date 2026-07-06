/**
 * T5: typography settings sheet — a bottom modal with live controls for
 * font, theme, font size, line height, paragraph spacing and page margin.
 * Every change applies instantly (via the settings context) and persists.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  FONT_BOUNDS,
  LINE_HEIGHT_BOUNDS,
  MARGIN_BOUNDS,
  PARAGRAPH_SPACING_BOUNDS,
  type NumericBounds,
} from '../lib/settings/settings';
import { FONT_OPTIONS, THEME_OPTIONS, stepValue } from '../lib/settings/options';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from './SettingsContext';

interface ReaderSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ReaderSettingsSheet({ visible, onClose }: ReaderSettingsSheetProps) {
  const { settings, update } = useSettings();
  const theme = resolveTheme(settings.themeId);

  const sheetBg = theme.background;
  const isLight = settings.themeId === 'paper' || settings.themeId === 'sepia' || settings.themeId === 'green';
  const accent = isLight ? '#2b2b2b' : '#f5f3ee';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: sheetBg, borderTopColor: theme.border }]}>
        <View style={styles.grabberWrap}>
          <View style={[styles.grabber, { backgroundColor: theme.subtle }]} />
        </View>

        {/* Font */}
        <Text style={[styles.sectionLabel, { color: theme.subtle }]}>字体</Text>
        <View style={styles.segmentRow}>
          {FONT_OPTIONS.map((opt) => {
            const active = settings.fontId === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => update({ fontId: opt.id })}
                style={[
                  styles.segment,
                  { borderColor: theme.border },
                  active && { backgroundColor: accent },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: active ? sheetBg : theme.text },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Theme */}
        <Text style={[styles.sectionLabel, { color: theme.subtle }]}>主题</Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((opt) => {
            const t = resolveTheme(opt.id);
            const active = settings.themeId === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => update({ themeId: opt.id })}
                style={styles.themeItem}
              >
                <View
                  style={[
                    styles.themeSwatch,
                    { backgroundColor: t.background, borderColor: active ? accent : theme.border },
                    active && styles.themeSwatchActive,
                  ]}
                >
                  <Text style={[styles.themeSwatchGlyph, { color: t.text }]}>文</Text>
                </View>
                <Text style={[styles.themeLabel, { color: active ? theme.text : theme.subtle }]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Numeric steppers */}
        <Stepper
          label="字号"
          value={settings.fontSize}
          bounds={FONT_BOUNDS}
          display={(v) => `${v}`}
          onStep={(dir) => update({ fontSize: stepValue(settings.fontSize, FONT_BOUNDS, dir) })}
          theme={theme}
          accent={accent}
          sheetBg={sheetBg}
        />
        <Stepper
          label="行距"
          value={settings.lineHeightMul}
          bounds={LINE_HEIGHT_BOUNDS}
          display={(v) => v.toFixed(1)}
          onStep={(dir) =>
            update({ lineHeightMul: stepValue(settings.lineHeightMul, LINE_HEIGHT_BOUNDS, dir) })
          }
          theme={theme}
          accent={accent}
          sheetBg={sheetBg}
        />
        <Stepper
          label="段距"
          value={settings.paragraphSpacing}
          bounds={PARAGRAPH_SPACING_BOUNDS}
          display={(v) => `${v}`}
          onStep={(dir) =>
            update({
              paragraphSpacing: stepValue(settings.paragraphSpacing, PARAGRAPH_SPACING_BOUNDS, dir),
            })
          }
          theme={theme}
          accent={accent}
          sheetBg={sheetBg}
        />
        <Stepper
          label="边距"
          value={settings.marginH}
          bounds={MARGIN_BOUNDS}
          display={(v) => `${v}`}
          onStep={(dir) => update({ marginH: stepValue(settings.marginH, MARGIN_BOUNDS, dir) })}
          theme={theme}
          accent={accent}
          sheetBg={sheetBg}
        />
      </View>
    </Modal>
  );
}

interface StepperProps {
  label: string;
  value: number;
  bounds: NumericBounds;
  display: (v: number) => string;
  onStep: (dir: 1 | -1) => void;
  theme: ReturnType<typeof resolveTheme>;
  accent: string;
  sheetBg: string;
}

function Stepper({ label, value, bounds, display, onStep, theme, accent, sheetBg }: StepperProps) {
  const atMin = value <= bounds.min;
  const atMax = value >= bounds.max;
  return (
    <View style={styles.stepperRow}>
      <Text style={[styles.stepperLabel, { color: theme.text }]}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={() => onStep(-1)}
          disabled={atMin}
          style={[styles.stepBtn, { borderColor: theme.border }, atMin && styles.stepBtnDisabled]}
        >
          <Text style={[styles.stepBtnText, { color: theme.text }]}>−</Text>
        </Pressable>
        <Text style={[styles.stepperValue, { color: theme.heading }]}>{display(value)}</Text>
        <Pressable
          onPress={() => onStep(1)}
          disabled={atMax}
          style={[styles.stepBtn, { borderColor: theme.border }, atMax && styles.stepBtnDisabled]}
        >
          <Text style={[styles.stepBtnText, { color: theme.text }]}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 44,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grabberWrap: { alignItems: 'center', paddingVertical: 10 },
  grabber: { width: 40, height: 4, borderRadius: 2, opacity: 0.5 },
  sectionLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 1, marginTop: 16, marginBottom: 10 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  segmentText: { fontSize: 15, fontWeight: '500' },
  themeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  themeItem: { alignItems: 'center', gap: 6 },
  themeSwatch: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeSwatchActive: { borderWidth: 2.5 },
  themeSwatchGlyph: { fontSize: 18, fontWeight: '600' },
  themeLabel: { fontSize: 12 },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  stepperLabel: { fontSize: 15, fontWeight: '500' },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.35 },
  stepBtnText: { fontSize: 22, fontWeight: '400', lineHeight: 26 },
  stepperValue: { fontSize: 16, fontWeight: '600', minWidth: 40, textAlign: 'center' },
});
