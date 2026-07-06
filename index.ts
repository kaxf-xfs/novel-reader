// --- Node core polyfills for React Native (must run before any app code) ---
// iconv-lite (GBK decoding, T1) and our Buffer.byteLength/Buffer.from usage
// (T3/T4) assume a Node-like environment. RN/Hermes has no global Buffer or
// process, so install them here. Metro resolves the Node core modules
// (string_decoder, stream, …) via node-libs-react-native in metro.config.js.
import { Buffer } from 'buffer';
import process from 'process';

const g = globalThis as unknown as { Buffer?: unknown; process?: unknown };
if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;
if (typeof g.process === 'undefined') g.process = process;
// ---------------------------------------------------------------------------

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
