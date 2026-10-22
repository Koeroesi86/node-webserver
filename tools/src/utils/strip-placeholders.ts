/** the text without the comments of the template and the empty bullets, which is what a person wrote */
export const stripPlaceholders = (text: string) =>
  text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*-\s*$/gm, '')
    .trim();
