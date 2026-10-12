const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => entities[character]);

export default escapeHtml;
