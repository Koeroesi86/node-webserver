const chalk = require('chalk');

module.exports = {
  system: message => console.log(chalk.blue(message)),
  info: message => console.log(chalk.magenta(message)),
  success: message => console.log(chalk.green(message)),
  error: message => console.log(chalk.red(message)),
  warning: message => console.log(chalk.yellow(message)),
};
