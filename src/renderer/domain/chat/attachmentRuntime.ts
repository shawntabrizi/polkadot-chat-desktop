/**
 * The app's one attachment service (spec 0012), set by App when the chat
 * manager starts and cleared when it stops. Bubbles and the composer read
 * it here instead of threading it through every room component.
 */

import type { AttachmentService } from './attachments';

let current: AttachmentService | null = null;
const listeners = new Set<VoidFunction>();

export const setAttachmentService = (service: AttachmentService | null): void => {
  current = service;
  for (const listener of listeners) listener();
};

export const attachmentService = (): AttachmentService | null => current;

export const subscribeAttachmentService = (listener: VoidFunction): VoidFunction => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
