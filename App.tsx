import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.wordmark}>NovelReader</Text>
      <Text style={styles.tagline}>沉浸阅读 · 极简排版</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#15171c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    color: '#f5f3ee',
    fontSize: 34,
    fontWeight: '600',
    letterSpacing: 1,
  },
  tagline: {
    color: '#8b8f99',
    fontSize: 15,
    marginTop: 12,
    letterSpacing: 4,
  },
});
