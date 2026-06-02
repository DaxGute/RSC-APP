/** Expo config — merges app.json; use this file for JS overrides (app.json is strict JSON). */
const appJson = require('./app.json');

module.exports = {
  expo: {
    ...appJson.expo,
  },
};
