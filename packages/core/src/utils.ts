/**
 * Sanitize a section title into a safe filename.
 * Appends a short ID suffix to guarantee uniqueness even if titles collide.
 */
export function sanitizeFilename(title: string, sectionId: string, includeId = true): string {
  const sanitized = title
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s-]/gi, "")
    .replace(/\s+/g, "-")
    .substring(0, 50);
  const base = sanitized || "untitled";
  if (!includeId) return base;
  const idSuffix = sectionId.slice(0, 8);
  return `${base}-${idSuffix}`;
}
