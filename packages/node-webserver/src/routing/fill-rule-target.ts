/** a character that is not printable ASCII, and the backslash that browsers read as a slash, so that a capture cannot make a URL of another place */
const unsafeCharacter = /[^\x21-\x7e]|\\/g;

/** the target of a rule with its `{name}` placeholders replaced by the captures of the pattern, a group that took no part in the match by nothing */
const fillRuleTarget = (target: string, parameters: Record<string, string> = {}) =>
  target.replace(/\{(\w+)\}/g, (_placeholder, name: string) =>
    (Object.hasOwn(parameters, name) ? parameters[name] : '').replace(unsafeCharacter, encodeURIComponent)
  );

export default fillRuleTarget;
