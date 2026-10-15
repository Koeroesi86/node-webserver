/** the name ends up in a file name and on a command line */
const validateServiceName = (name: unknown): string => {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(name) || name.startsWith('.') || name.startsWith('-')) {
    throw new Error(`Invalid serviceName ${JSON.stringify(name)}: use letters, digits, "_", "." and "-", not starting with "." or "-".`);
  }
  return name;
};

export default validateServiceName;
