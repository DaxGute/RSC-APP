module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated’s plugin already wraps `react-native-worklets/plugin` — list it only once (must be last).
    plugins: ['react-native-reanimated/plugin'],
  };
};
