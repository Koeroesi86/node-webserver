/**
 * @param {string[]} argv
 * @returns {Object}
 */
function parseArgv(argv = process.argv) {
  let skipNext = false;
  const parsedArgv =argv.reduce((result, current, index) => {
    if (index < 2) {
      result[index] = current;
      return result;
    }

    if (current.indexOf('-') === 0) {
      if (skipNext) {
        skipNext = false;
        return result;
      }
      const matches = current.match(/[-]{1,2}([a-zA-Z0-9\-]+)[=]?["']?([a-zA-Z0-9/\\.\-:]+)*["']?/);
      result[matches[1]] = true;
      if (matches[2]) {
        // if there is value set
        result[matches[1]] = matches[2];
      } else if (argv[Number(index) + 1] && argv[Number(index) + 1].indexOf('-') !== 0) {
        // handle spaces
        skipNext = true;
        result[matches[1]] = argv[Number(index) + 1].match(/["']?([a-zA-Z0-9/\\.\-:]+)*["']?/)[1];
        return result;
      }
      return result;
    }

    return result;
  }, {});

  return parsedArgv;
}

module.exports = parseArgv;
