// Karma configuration.
// Windows: set CHROME_BIN to the Edge binary (Chromium based) and run `npm test -- --watch=false --browsers=EdgeHeadless`.
// Linux/CI: `npm run test:ci` (ChromeHeadlessNoSandbox; CHROME_BIN pointing at chrome/chromium).
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
    ],
    client: {
      jasmine: { random: true },
      clearContext: false,
    },
    jasmineHtmlReporter: { suppressAll: true },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/investment-ops-ui'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['EdgeHeadless'],
    customLaunchers: {
      EdgeHeadless: {
        base: 'ChromeHeadless',
        flags: ['--disable-gpu', '--disable-dev-shm-usage', '--window-size=1280,900'],
      },
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1280,900'],
      },
    },
    restartOnFileChange: true,
    browserNoActivityTimeout: 120000,
    captureTimeout: 120000,
  });
};
