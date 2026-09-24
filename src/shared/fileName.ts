/**
 * Spec 0012: an attachment's name comes from a remote message. Before the
 * main process writes the file (Open, Save…) it becomes a plain file name.
 */

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
};

/** A name safe to write: no folders, no control or reserved characters, at most 128 characters, with an extension from the MIME type when it has none. */
export const safeFileName = (name: unknown, mime: unknown): string => {
  const raw = typeof name === 'string' ? name : '';
  const base = raw.split(/[/\\]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- control characters are what this removes
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim().slice(0, 128);
  const type = typeof mime === 'string' ? (mime.split(';')[0] ?? '').trim().toLowerCase() : '';
  const extension = EXTENSIONS[type];
  const stem = clean === '' ? 'attachment' : clean;
  return extension && !/\.[a-z0-9]{1,5}$/i.test(stem) ? `${stem}.${extension}` : stem;
};
