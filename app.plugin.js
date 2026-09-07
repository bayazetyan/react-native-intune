/**
 * Expo's entry point for this package's config plugin.
 *
 * `app.plugin.js` at the package root is the convention Expo looks for, which is what
 * lets a consumer write the package name alone in their `plugins` array rather than a
 * path into it:
 *
 *   "plugins": [["react-native-intune", { "androidSignatureHash": "..." }]]
 */
module.exports = require('./plugin/withIntune');
