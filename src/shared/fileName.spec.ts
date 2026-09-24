import { describe, expect, it } from 'vitest';

import { safeFileName } from './fileName';

// Why: the name is chosen by whoever sent the message; "Open" writes the
// file to disk before the OS opens it, so a name must never climb out of its
// folder or smuggle in reserved characters.
describe('safeFileName', () => {
  it('keeps only the last path part and drops reserved characters', () => {
    expect(safeFileName('../../etc/passwd', 'image/png')).toBe('passwd.png');
    expect(safeFileName('..\\..\\evil.jpg', 'image/jpeg')).toBe('evil.jpg');
    expect(safeFileName('a<b>c:"d|e?f*.png\u0000', 'image/png')).toBe('abcdef.png');
    expect(safeFileName('.hidden', 'image/png')).toBe('hidden.png');
  });

  it('names a photo without a name from its MIME type', () => {
    expect(safeFileName(null, 'image/jpeg')).toBe('attachment.jpg');
    expect(safeFileName('', 'audio/ogg; codecs=opus')).toBe('attachment.ogg');
    expect(safeFileName(undefined, 'application/x-unknown')).toBe('attachment');
  });

  it('is at most 128 characters before the extension', () => {
    expect(safeFileName('x'.repeat(500), 'image/png').length).toBe(128 + '.png'.length);
  });
});
