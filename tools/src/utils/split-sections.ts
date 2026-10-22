/** the text under every `## ` heading of the markdown, by heading */
export const splitSections = (markdown: string) =>
  new Map(
    markdown
      .split(/^## /m)
      .slice(1)
      .map((part): [string, string] => {
        const [heading = '', ...lines] = part.split('\n');

        return [heading.trim(), lines.join('\n')];
      })
  );
