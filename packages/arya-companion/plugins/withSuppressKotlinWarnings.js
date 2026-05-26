const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Config plugin that adds kotlinOptions to suppress deprecation warnings
 * in generated Android code (e.g. ReactNativeHost deprecation from React Native).
 */
function withSuppressKotlinWarnings(config) {
  return withAppBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;

    // Add kotlinOptions block after the android { block if not already present
    if (!buildGradle.includes("kotlinOptions")) {
      const androidBlockEnd = "android {";
      const kotlinOptions = `android {
    kotlinOptions {
        freeCompilerArgs += ["-Xsuppress-warning=DEPRECATION", "-Xsuppress-warning=OVERRIDE_DEPRECATION"]
    }`;

      config.modResults.contents = buildGradle.replace(
        androidBlockEnd,
        kotlinOptions
      );
    }

    return config;
  });
}

module.exports = withSuppressKotlinWarnings;
