export interface ParsedArgv {
  [key: string]: string | boolean | undefined;
}

const ARGUMENT_PATTERN = /[-]{1,2}([a-zA-Z0-9-]+)[=]?["']?([a-zA-Z0-9/\\.\-:]+)*["']?/;
const VALUE_PATTERN = /["']?([a-zA-Z0-9/\\.\-:]+)*["']?/;

function parseArgv(argv: string[] = process.argv): ParsedArgv {
  let skipNext = false;

  return argv.reduce<ParsedArgv>((result, current, index) => {
    if (index < 2) {
      result[index] = current;
      return result;
    }

    if (current.indexOf('-') !== 0) {
      return result;
    }

    if (skipNext) {
      skipNext = false;
      return result;
    }

    const matches = current.match(ARGUMENT_PATTERN);

    if (!matches) {
      return result;
    }

    const [, key, inlineValue] = matches;
    result[key] = inlineValue || true;

    const nextArgument = argv[index + 1];

    if (inlineValue || !nextArgument || nextArgument.indexOf('-') === 0) {
      return result;
    }

    // handle spaces
    skipNext = true;
    result[key] = nextArgument.match(VALUE_PATTERN)?.[1];
    return result;
  }, {});
}

export default parseArgv;
