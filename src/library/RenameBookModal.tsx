/** 增量3: 书架重命名弹窗——预填当前书名，保存 trim 后的非空/已变更标题。 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { BookRecord } from '../lib/import/repository';

interface RenameBookModalProps {
  visible: boolean;
  book: BookRecord | null;
  onSave: (title: string) => void;
  onClose: () => void;
}

export function RenameBookModal({ visible, book, onSave, onClose }: RenameBookModalProps) {
  const [text, setText] = useState('');

  // Sync the field to the book each time a (new) book is opened for rename.
  useEffect(() => {
    setText(book?.title ?? '');
  }, [book]);

  const trimmed = text.trim();
  const canSave = trimmed.length > 0 && trimmed !== (book?.title ?? '').trim();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <View testID="rename-modal" style={styles.card}>
          <Text style={styles.heading}>重命名</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="书名"
            placeholderTextColor="#9a958c"
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canSave) onSave(trimmed);
            }}
          />
          <View style={styles.row}>
            <Pressable style={styles.btn} onPress={onClose}>
              <Text style={styles.btnCancel}>取消</Text>
            </Pressable>
            <Pressable
              testID="rename-save"
              style={styles.btn}
              disabled={!canSave}
              onPress={() => {
                if (canSave) onSave(trimmed);
              }}
            >
              <Text style={[styles.btnSave, !canSave && styles.btnDisabled]}>保存</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  heading: { fontSize: 16, fontWeight: '700', color: '#1f1d19', marginBottom: 14 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8d3c8',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1f1d19',
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  btn: { paddingVertical: 10, paddingHorizontal: 16 },
  btnCancel: { fontSize: 15, color: '#8a8478' },
  btnSave: { fontSize: 15, fontWeight: '700', color: '#2c7a6b' },
  btnDisabled: { color: '#bcb8ae' },
});
