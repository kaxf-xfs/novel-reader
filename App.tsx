import { useCallback, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';

import { SqliteBookRepository } from './src/lib/import/sqliteRepository';
import { ExpoFileGateway } from './src/lib/import/expoFileGateway';
import { ExpoSettingsGateway } from './src/lib/settings/expoSettingsGateway';
import { CANGER_FONT_FAMILY } from './src/lib/settings/styles';
import { SettingsProvider } from './src/settings/SettingsContext';
import { AiConfigProvider } from './src/settings/AiConfigContext';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { StatsScreen } from './src/screens/StatsScreen';

type Screen = { name: 'library' } | { name: 'reader'; bookId: string } | { name: 'stats' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' });

  // 仓耳今楷 is loaded at runtime (not embedded natively) so it ships via OTA.
  // Loading is non-blocking: until it's ready, text using this family falls
  // back to the system font, then re-renders once loaded.
  useFonts({ [CANGER_FONT_FAMILY]: require('./assets/fonts/CangEr-JinKai04.ttf') });

  // Single long-lived instances, shared across the app.
  const repo = useMemo(() => new SqliteBookRepository(), []);
  const fs = useMemo(() => new ExpoFileGateway(), []);
  const settingsGateway = useMemo(() => new ExpoSettingsGateway(), []);
  const aiGateway = useMemo(() => new ExpoSettingsGateway('ai-config.json'), []);

  const openBook = useCallback((bookId: string) => {
    setScreen({ name: 'reader', bookId });
  }, []);

  const backToLibrary = useCallback(() => {
    setScreen({ name: 'library' });
  }, []);

  const openStats = useCallback(() => {
    setScreen({ name: 'stats' });
  }, []);

  return (
    <SettingsProvider gateway={settingsGateway}>
      <AiConfigProvider gateway={aiGateway}>
        <View style={styles.container}>
          <StatusBar style="dark" />
          {screen.name === 'library' ? (
            <LibraryScreen repo={repo} fs={fs} onOpenBook={openBook} onOpenStats={openStats} />
          ) : screen.name === 'reader' ? (
            <ReaderScreen repo={repo} fs={fs} bookId={screen.bookId} onBack={backToLibrary} />
          ) : (
            <StatsScreen repo={repo} onBack={backToLibrary} />
          )}
        </View>
      </AiConfigProvider>
    </SettingsProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#15171c',
  },
});
