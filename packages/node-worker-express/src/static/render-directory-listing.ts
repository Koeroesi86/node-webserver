import escapeHtml from './escape-html';

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
}

/** A plain page that lists the entries, folders first. Names are escaped, and encoded in the links. */
const renderDirectoryListing = (requestPath: string, entries: DirectoryEntry[]) => {
  const title = escapeHtml(`Index of ${requestPath}`);
  const items = [...entries]
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
    .map(
      ({ name, isDirectory }) =>
        `<li><a href="${escapeHtml(encodeURIComponent(name))}${isDirectory ? '/' : ''}">${escapeHtml(name)}${isDirectory ? '/' : ''}</a></li>`
    );

  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><ul>${
    requestPath === '/' ? '' : '<li><a href="../">../</a></li>'
  }${items.join('')}</ul></body></html>\n`;
};

export default renderDirectoryListing;
