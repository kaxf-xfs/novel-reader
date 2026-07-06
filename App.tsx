import { useCallback, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { SqliteBookRepository } from './src/lib/import/sqliteRepository';
import { ExpoFileGateway } from './src/lib/import/expoFileGateway';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';

type Screen = { name: 'library' } | { name: 'reader'; bookId: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' });

  // Single long-lived instances, shared by both screens.
  const repo = useMemo(() => new SqliteBookRepository(), []);
  const fs = useMemo(() => new ExpoFileGateway(), []);

  const openBook = useCallback((bookId: string) => {
    setScreen({ name: 'reader', bookId });
  }, []);

  const backToLibrary = useCallback(() => {
    setScreen({ name: 'library' });
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {screen.name === 'library' ? (
        <LibraryScreen repo={repo} fs={fs} onOpenBook={openBook} />
      ) : (
        <ReaderScreen repo={repo} fs={fs} bookId={screen.bookId} onBack={backToLibrary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#15171c',
  },
});
