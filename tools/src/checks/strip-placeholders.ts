/** the text without the comments of the template and the empty bullets, which is what a person wrote */
export const stripPlaceholders = (text: string) =>
  text
    .split('-->')
    .map((part) => part.split('<!--')[0])
    .join('')
    .replace(/^\s*-\s*$/gm, '')
    .trim();
