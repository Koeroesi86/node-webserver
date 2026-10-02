module.exports = configPath => {
  (async () => {
    await new Promise(r => setTimeout(r, 1));
    const nws = require('@koeroesi86/node-webserver');
    const config = require(configPath);
    await nws(config);
  })();
};
