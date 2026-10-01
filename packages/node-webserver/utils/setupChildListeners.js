const setupChildListener = require('./setupChildListener');

module.exports = (instances = []) => {
  instances.forEach(instance => {
    const { child } = instance;

    if (child) {
      setupChildListener(child);
    }
  });
};
