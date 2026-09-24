// Spec 0012 (M15a): the composer's attach row and the image bubble. Design
// system: inline, no modal; honest progress (chunks stored or fetched, never a
// fake percentage); Open and Save… go through the main process.

import { Download, ExternalLink, Loader2, Paperclip, RotateCw, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { AttachmentRow, MessageRow } from '../app/database';
import { attachmentService, subscribeAttachmentService } from '../domain/chat/attachmentRuntime';
import { autoDownloads, formatSize, getAttachmentRow } from '../domain/chat/attachments';
import { decodeBlurhash } from '../domain/chat/blurhash';
import type { AttachmentItem } from '../domain/chat/content';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import { useLiveQuery } from './useLiveQuery';

/** Shown once, above the first attachment this device sends (review 0012: the ciphertext is public for 14 days). */
export const FIRST_ATTACHMENT_NOTICE = 'Stored encrypted on the Bulletin chain for 14 days; only people in this chat hold the key';

/** An object URL for `bytes` while mounted. */
const useObjectUrl = (bytes: Uint8Array | null | undefined, mime: string): string | null => {
  const url = useMemo(() => (bytes ? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime })) : null), [bytes, mime]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
};

/** The composer's inline row: the picked image, its size, Remove; the one-time notice under it. */
export const AttachRow = ({ file, notice, onRemove }: { file: File; notice: boolean; onRemove: () => void }) => {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="flex flex-col gap-1" data-testid="attach-row">
      <div className="flex items-center gap-3 rounded-nested bg-surface-nested py-2 ps-2 pe-2">
        <img src={url} alt="" className="size-12 shrink-0 rounded-small object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-m text-fg-primary">{file.name || 'Image'}</p>
          <p className="text-body-s text-fg-secondary">
            <Paperclip className="me-1 inline size-3.5 align-[-2px]" aria-hidden />
            {formatSize(file.size)} · encrypted before it leaves this computer
          </p>
        </div>
        <Button variant="ghost" size="sm" className="rounded-full font-normal" onClick={onRemove} data-testid="attach-remove">
          <X className="size-4 text-fg-secondary" aria-hidden /> Remove
        </Button>
      </div>
      {notice ? (
        <p className="px-1 text-caption text-fg-tertiary" data-testid="attach-notice">
          {FIRST_ATTACHMENT_NOTICE}
        </p>
      ) : null}
    </div>
  );
};

const useService = () => useSyncExternalStore(subscribeAttachmentService, attachmentService, attachmentService);

/** The blurhash painted at its own small size; CSS scales it to the frame. The canvas also gives the frame its aspect ratio. */
const Placeholder = ({ item }: { item: AttachmentItem }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const media = item.media.kind === 'image' || item.media.kind === 'video' ? item.media : { width: 4, height: 3 };
  const width = 32;
  const height = Math.max(1, Math.min(96, Math.round((32 * media.height) / Math.max(1, media.width))));
  useEffect(() => {
    const pixels = item.blurhash ? decodeBlurhash(item.blurhash, width, height) : null;
    const context = canvas.current?.getContext('2d');
    if (pixels && context) context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  }, [item.blurhash, width, height]);
  return <canvas ref={canvas} width={width} height={height} className="block h-auto w-full" data-testid="attachment-blurhash" aria-hidden />;
};

const StateChip = ({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-caption shadow-1',
      tone === 'error' ? 'text-fg-error' : 'text-fg-primary',
    )}
  >
    {children}
  </span>
);

const stateLine = (local: AttachmentRow | undefined, item: AttachmentItem, own: boolean, onFetch: () => void) => {
  if (!local) {
    return own ? null : (
      <button type="button" className="cursor-pointer" onClick={onFetch} data-testid="attachment-download">
        <StateChip>
          <Download className="size-3.5" aria-hidden /> Download · {formatSize(item.size)}
        </StateChip>
      </button>
    );
  }
  switch (local.status) {
    case 'uploading':
      return (
        <StateChip>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Storing {local.done} of {local.total}
        </StateChip>
      );
    case 'uploadFailed':
      return <StateChip tone="error">Upload failed</StateChip>;
    case 'downloading':
      return (
        <StateChip>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Downloading {local.done} of {local.total}
        </StateChip>
      );
    case 'failed':
      return (
        <button type="button" className="cursor-pointer" onClick={onFetch} data-testid="attachment-retry">
          <StateChip tone="error">
            Download failed · <RotateCw className="size-3.5" aria-hidden /> Retry
          </StateChip>
        </button>
      );
    case 'expired':
      return <StateChip tone="error">Attachment expired</StateChip>;
    case 'damaged':
      return <StateChip tone="error">Attachment is damaged</StateChip>;
    case 'ready':
      return null;
  }
};

const ItemView = ({ messageId, index, item, own }: { messageId: string; index: number; item: AttachmentItem; own: boolean }) => {
  const service = useService();
  // Wrapped, so "not read yet" (undefined) and "no row" (null) differ: a download starts only for a missing row.
  const state = useLiveQuery(async () => ({ row: (await getAttachmentRow(messageId, index)) ?? null }), [messageId, index]);
  const loaded = state !== undefined;
  const local = state?.row ?? undefined;
  const ready = local?.status === 'ready' && local.bytes ? local.bytes : null;
  const url = useObjectUrl(ready, item.mime);
  const thumbnail = useObjectUrl(item.thumbnail, 'image/webp');
  const [actionError, setActionError] = useState<string | null>(null);
  const fetchNow = () => void service?.fetch(messageId, index, item);

  // Auto-download (spec 0012): images of at most 5 MiB, once the row is known to be missing.
  useEffect(() => {
    if (!service || !loaded || local || !autoDownloads(item)) return;
    void service.fetch(messageId, index, item);
  }, [service, loaded, local, item, messageId, index]);

  const files = window.desktop?.files;
  const act = (what: 'open' | 'save') => {
    if (!ready || !files) return;
    setActionError(null);
    const work = what === 'open' ? files.open(ready, item.name, item.mime) : files.save(ready, item.name, item.mime);
    void work.catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'That did not work.'));
  };
  const line = stateLine(local, item, own, fetchNow);

  return (
    <div className="flex flex-col gap-1" data-testid="attachment-item" data-status={local?.status ?? 'none'}>
      <div className="relative max-h-80 w-60 max-w-full overflow-hidden rounded-medium bg-surface-container">
        <Placeholder item={item} />
        {thumbnail && !url ? <img src={thumbnail} alt="" className="absolute inset-0 size-full object-cover" /> : null}
        {url ? <img src={url} alt={item.name ?? 'Photo'} className="absolute inset-0 size-full object-cover" data-testid="attachment-image" /> : null}
        {line ? <div className="absolute start-2 bottom-2">{line}</div> : null}
      </div>
      {ready ? (
        <div className={cn('flex gap-1', own ? 'justify-end' : 'justify-start')}>
          <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 font-normal" onClick={() => act('open')} data-testid="attachment-open">
            <ExternalLink className="size-3.5" aria-hidden /> Open
          </Button>
          <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 font-normal" onClick={() => act('save')} data-testid="attachment-save">
            <Download className="size-3.5" aria-hidden /> Save…
          </Button>
        </div>
      ) : null}
      {actionError ? <p className="text-caption text-fg-error">{actionError}</p> : null}
    </div>
  );
};

/** The body of a kind-250 bubble: each item, then the caption. */
export const AttachmentBody = ({ row, own }: { row: MessageRow; own: boolean }) => {
  if (row.content.type !== 'attachment') return null;
  const { items, caption } = row.content;
  return (
    <div className="flex flex-col gap-2" data-testid="attachment">
      {items.map((item, index) => (
        <ItemView key={index} messageId={row.messageId} index={index} item={item} own={own} />
      ))}
      {caption ? <p className="text-body-m whitespace-pre-wrap">{caption}</p> : null}
    </div>
  );
};
