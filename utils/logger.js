const chalk = require('chalk');

module.exports = {
  system: (...args) => console.log(chalk.blue(...args)),
  info: (...args) => console.log(chalk.magenta(...args)),
  success: (...args) => console.log(chalk.green(...args)),
  error: (...args) => console.log(chalk.red(...args)),
  warning: (...args) => console.log(chalk.yellow(...args)),
};
