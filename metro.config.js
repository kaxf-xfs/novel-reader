// Metro config: shim Node core modules so Node-style libs (iconv-lite for GBK
// decoding) can be bundled for React Native. Without this, Metro fails with
// "Unable to resolve module string_decoder / stream" once the encoding chain
// is imported. Runtime globals (Buffer/process) are set in index.ts.
const { getDefaultConfig } = require('expo/metro-config');
const nodeLibs = require('node-libs-react-native');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...nodeLibs,
  ...(config.resolver.extraNodeModules || {}),
};

module.exports = config;
