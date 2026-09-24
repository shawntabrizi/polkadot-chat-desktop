// Spec 0012: the composer's attach row and the attachment bubbles. M15a:
// the image bubble. M15b: the album grid, the file row, the voice recorder
// strip and the voice player. Design system: inline, no modal; honest
// progress (chunks stored or fetched, never a fake percentage); Open and
// Save… go through the main process.

import {
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Loader2,
  Pause,
  Paperclip,
  Play,
  RefreshCcw,
  RotateCw,
  SendHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { AttachmentRow, MessageRow } from '../app/database';
import { HOP_MAX_FILE_BYTES } from '../../shared/desktop-api';
import { attachmentService, subscribeAttachmentService } from '../domain/chat/attachmentRuntime';
import { HOP_SENT_LINE, autoDownloads, formatSize, getAttachmentRow, hopItemOf, isImageType, resendName } from '../domain/chat/attachments';
import { isVideoType } from '../domain/chat/attachmentVideo';
import { getMessage } from '../domain/chat/messages';
import { decodeBlurhash } from '../domain/chat/blurhash';
import type { AttachmentItem } from '../domain/chat/content';
import { MAX_VOICE_MS, clockOf } from '../domain/chat/voice';
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

/** A picked file's preview: the image itself, or a type icon. */
const PickedThumb = ({ file }: { file: File }) => {
  const image = isImageType(file.type);
  const url = useMemo(() => (image ? URL.createObjectURL(file) : null), [file, image]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  if (url) return <img src={url} alt="" className="size-12 shrink-0 rounded-small object-cover" />;
  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-small bg-surface-container">
      <TypeIcon mime={file.type} name={file.name} className="size-6 text-fg-secondary" />
    </span>
  );
};

/**
 * The composer's inline row: what waits to be sent (one file, or an album of
 * up to 4 images), the total size, Remove; the one-time notice under it.
 */
export const AttachRow = ({ files, notice, onRemove }: { files: readonly File[]; notice: boolean; onRemove: (index: number | null) => void }) => {
  const [first] = files;
  if (!first) return null;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const album = files.length > 1;
  const title = album ? `${files.length} photos` : first.name || (isImageType(first.type) ? 'Image' : 'File');
  return (
    <div className="flex flex-col gap-1" data-testid="attach-row">
      <div className="flex items-center gap-3 rounded-nested bg-surface-nested py-2 ps-2 pe-2">
        <div className="flex shrink-0 gap-1">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="group/thumb relative">
              <PickedThumb file={file} />
              {album ? (
                <button
                  type="button"
                  className="absolute -end-1 -top-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-surface-container shadow-1"
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() => onRemove(index)}
                >
                  <X className="size-3 text-fg-secondary" aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-m text-fg-primary">{title}</p>
          <p className="text-body-s text-fg-secondary">
            <Paperclip className="me-1 inline size-3.5 align-[-2px]" aria-hidden />
            {formatSize(total)} · encrypted before it leaves this computer
          </p>
        </div>
        <Button variant="ghost" size="sm" className="rounded-full font-normal" onClick={() => onRemove(null)} data-testid="attach-remove">
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

/** The recorder strip over the composer while a voice note records: elapsed time, Cancel, Send. */
export const VoiceRecorderStrip = ({ startedAt, busy, notice, onCancel, onSend }: { startedAt: number; busy: boolean; notice: boolean; onCancel: () => void; onSend: () => void }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex flex-col gap-1" data-testid="voice-recorder">
      <div className="flex items-center gap-3 rounded-nested bg-surface-nested py-2 ps-3 pe-2">
        <span className={cn('size-2.5 shrink-0 rounded-full bg-fg-error', !busy && 'animate-pulse')} aria-hidden />
        <p className="min-w-0 flex-1 text-label-m text-fg-primary tabular-nums" data-testid="voice-elapsed">
          {busy ? 'Preparing…' : `Recording ${clockOf(now - startedAt)}`} <span className="text-body-s text-fg-tertiary">/ {clockOf(MAX_VOICE_MS)}</span>
        </p>
        <Button variant="ghost" size="sm" className="rounded-full font-normal" onClick={onCancel} disabled={busy} data-testid="voice-cancel">
          <Trash2 className="size-4 text-fg-secondary" aria-hidden /> Cancel
        </Button>
        <Button size="sm" className="rounded-full" onClick={onSend} disabled={busy} data-testid="voice-send">
          <SendHorizontal className="size-4" aria-hidden /> Send
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

type FileKind = 'image' | 'audio' | 'video' | 'archive' | 'sheet' | 'code' | 'text' | 'other';

/** A file's kind for its icon: from the MIME type, or the extension when the type is generic. */
export const fileKindOf = (mime: string, name: string | null): FileKind => {
  const type = mime.toLowerCase();
  const extension = /\.([a-z0-9]{1,7})$/i.exec(name ?? '')?.[1]?.toLowerCase() ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (/zip|compressed|tar|gzip|7z|rar/.test(type) || ['zip', 'gz', 'tgz', '7z', 'rar', 'tar'].includes(extension)) return 'archive';
  if (/spreadsheet|excel|csv/.test(type) || ['xlsx', 'xls', 'csv', 'ods', 'numbers'].includes(extension)) return 'sheet';
  if (/json|javascript|typescript|xml|x-sh|x-python/.test(type) || ['json', 'js', 'ts', 'py', 'rs', 'sh', 'xml', 'toml', 'yaml', 'yml'].includes(extension)) return 'code';
  if (type.startsWith('text/') || /pdf|word|document|rtf|presentation/.test(type) || ['pdf', 'txt', 'md', 'doc', 'docx', 'rtf', 'pages', 'key', 'pptx'].includes(extension)) return 'text';
  return 'other';
};

/** The type icon of a file. */
const TypeIcon = ({ mime, name, className }: { mime: string; name: string | null; className: string }) => {
  switch (fileKindOf(mime, name)) {
    case 'image':
      return <FileImage className={className} aria-hidden />;
    case 'audio':
      return <FileAudio className={className} aria-hidden />;
    case 'video':
      return <FileVideo className={className} aria-hidden />;
    case 'archive':
      return <FileArchive className={className} aria-hidden />;
    case 'sheet':
      return <FileSpreadsheet className={className} aria-hidden />;
    case 'code':
      return <FileCode className={className} aria-hidden />;
    case 'text':
      return <FileText className={className} aria-hidden />;
    case 'other':
      return <FileIcon className={className} aria-hidden />;
  }
};

/** "PDF", "ZIP", "WEBM": the short type shown next to the size. */
const typeLabel = (mime: string, name: string | null): string => {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(name ?? '')?.[1];
  if (extension) return extension.toUpperCase();
  const sub = (mime.split(';')[0] ?? '').split('/')[1] ?? '';
  return sub === '' || sub === 'octet-stream' ? 'File' : sub.replace(/^x-/, '').slice(0, 8).toUpperCase();
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

const StateChip = ({ children, tone = 'info', className }: { children: ReactNode; tone?: 'info' | 'error'; className?: string }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-caption shadow-1',
      tone === 'error' ? 'text-fg-error' : 'text-fg-primary',
      className,
    )}
  >
    {children}
  </span>
);

/** M15c: under an expired or missing download, ask the sender to store it again (one text message). */
const AskResend = ({ local, onAsk }: { local: AttachmentRow; onAsk: () => void }) =>
  local.resendAskedAt !== undefined ? (
    <StateChip>
      <Loader2 className="size-3.5 animate-spin" aria-hidden /> Asked to resend · waiting
    </StateChip>
  ) : (
    <button type="button" className="cursor-pointer" onClick={onAsk} data-testid="attachment-ask-resend">
      <StateChip>
        <RefreshCcw className="size-3.5" aria-hidden /> Ask to resend
      </StateChip>
    </button>
  );

/** HOP receive: what a file over the cap says instead of Download. */
const TOO_LARGE = `Too large to download here (the limit is ${HOP_MAX_FILE_BYTES / (1024 * 1024)} MB)`;

const stateLine = (local: AttachmentRow | undefined, item: AttachmentItem, own: boolean, onFetch: () => void, onAsk: () => void) => {
  if (!local && item.via === 'hop' && item.size > HOP_MAX_FILE_BYTES) return <StateChip tone="error">{TOO_LARGE}</StateChip>;
  if (!local || local.status === 'freed') {
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
      if (!own && local.resendAskedAt !== undefined) return <AskResend local={local} onAsk={onAsk} />;
      return (
        <span className="inline-flex flex-wrap gap-1">
          <button type="button" className="cursor-pointer" onClick={onFetch} title={local.error ?? undefined} data-testid="attachment-retry">
            <StateChip tone="error">
              Download failed · <RotateCw className="size-3.5" aria-hidden /> Retry
            </StateChip>
          </button>
          {own ? null : <AskResend local={local} onAsk={onAsk} />}
        </span>
      );
    case 'expired':
      return (
        <span className="inline-flex flex-wrap gap-1">
          <StateChip tone="error">Attachment expired</StateChip>
          {own ? null : <AskResend local={local} onAsk={onAsk} />}
        </span>
      );
    case 'damaged':
      return <StateChip tone="error">Attachment is damaged</StateChip>;
    case 'unavailable':
      return (
        <span className="inline-flex flex-wrap gap-1" data-testid="attachment-unavailable">
          {/* Two lines in a 240 px photo: a pill's round ends would crowd them. */}
          <StateChip tone="error" className="rounded-small">
            No longer available from the sender's node
          </StateChip>
          {own ? null : <AskResend local={local} onAsk={onAsk} />}
        </span>
      );
    case 'tooLarge':
      return <StateChip tone="error">{TOO_LARGE}</StateChip>;
    case 'ready':
      return null;
  }
};

/** One item's local state, its auto-download, and Open / Save… of the decrypted bytes. */
const useItem = (messageId: string, index: number, item: AttachmentItem) => {
  const service = useService();
  // Wrapped, so "not read yet" (undefined) and "no row" (null) differ: a download starts only for a missing row.
  const state = useLiveQuery(async () => ({ row: (await getAttachmentRow(messageId, index)) ?? null }), [messageId, index]);
  const loaded = state !== undefined;
  const local = state?.row ?? undefined;
  const ready = local?.status === 'ready' && local.bytes ? local.bytes : null;
  const [actionError, setActionError] = useState<string | null>(null);
  const fetchNow = () => void service?.fetch(messageId, index, item);
  const askResend = () => {
    if (!service) return;
    setActionError(null);
    service.askResend(messageId, index).catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'The request was not sent.'));
  };

  // Auto-download (spec 0012): images and voice notes of at most 5 MiB, once the row is known to be missing.
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
  return { local, ready, fetchNow, askResend, act, actionError };
};

const ActionError = ({ text }: { text: string | null }) => (text ? <p className="text-caption text-fg-error">{text}</p> : null);

const OpenSave = ({ own, act }: { own: boolean; act: (what: 'open' | 'save') => void }) => (
  <div className={cn('flex gap-1', own ? 'justify-end' : 'justify-start')}>
    <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 font-normal" onClick={() => act('open')} data-testid="attachment-open">
      <ExternalLink className="size-3.5" aria-hidden /> Open
    </Button>
    <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 font-normal" onClick={() => act('save')} data-testid="attachment-save">
      <Download className="size-3.5" aria-hidden /> Save…
    </Button>
  </div>
);

/** The picture of an image item: blurhash, then the thumbnail, then the decrypted image. */
const ImageFrame = ({ item, ready, className }: { item: AttachmentItem; ready: Uint8Array | null; className?: string }) => {
  const url = useObjectUrl(ready, item.mime);
  const thumbnail = useObjectUrl(item.thumbnail, 'image/webp');
  return (
    <>
      <Placeholder item={item} />
      {thumbnail && !url ? <img src={thumbnail} alt="" className={cn('absolute inset-0 size-full object-cover', className)} /> : null}
      {url ? <img src={url} alt={item.name ?? 'Photo'} className={cn('absolute inset-0 size-full object-cover', className)} data-testid="attachment-image" /> : null}
    </>
  );
};

type ItemProps = { messageId: string; index: number; item: AttachmentItem; own: boolean };

const ImageItem = ({ messageId, index, item, own }: ItemProps) => {
  const { local, ready, fetchNow, askResend, act, actionError } = useItem(messageId, index, item);
  const line = stateLine(local, item, own, fetchNow, askResend);
  return (
    <div className="flex flex-col gap-1" data-testid="attachment-item" data-status={local?.status ?? 'none'}>
      <div className="relative max-h-80 w-60 max-w-full overflow-hidden rounded-medium bg-surface-container">
        <ImageFrame item={item} ready={ready} />
        {line ? <div className="absolute start-2 bottom-2">{line}</div> : null}
      </div>
      {ready ? <OpenSave own={own} act={act} /> : null}
      <ActionError text={actionError} />
    </div>
  );
};

/** One square of an album: click opens it with the default app; a small Save… in the corner. */
const AlbumTile = ({ messageId, index, item, own }: ItemProps) => {
  const { local, ready, fetchNow, askResend, act, actionError } = useItem(messageId, index, item);
  const line = stateLine(local, item, own, fetchNow, askResend);
  return (
    <div className="group/tile relative aspect-square overflow-hidden bg-surface-container" data-testid="attachment-item" data-status={local?.status ?? 'none'} title={actionError ?? undefined}>
      <button type="button" className="absolute inset-0 cursor-pointer disabled:cursor-default" disabled={!ready} onClick={() => act('open')} aria-label={`Open photo ${index + 1}`}>
        <span className="absolute inset-0 [&>canvas]:size-full">
          <ImageFrame item={item} ready={ready} />
        </span>
      </button>
      {line ? <div className="absolute start-1.5 bottom-1.5">{line}</div> : null}
      {ready ? (
        <button
          type="button"
          className="absolute end-1.5 top-1.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-surface-container text-fg-primary opacity-0 shadow-1 transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100"
          onClick={() => act('save')}
          aria-label={`Save photo ${index + 1}`}
          data-testid="attachment-save"
        >
          <Download className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
};

/** M15b: an album of 2 to 4 images, one bubble, a 2-column grid (3 images: the first spans the top). */
const AlbumGrid = ({ row, items, own }: { row: MessageRow; items: readonly AttachmentItem[]; own: boolean }) => (
  <div className="grid w-72 max-w-full grid-cols-2 gap-0.5 overflow-hidden rounded-medium" data-testid="attachment-album" data-count={items.length}>
    {items.map((item, index) => (
      <div key={index} className={cn(items.length === 3 && index === 0 && 'col-span-2 [&>div]:aspect-[2/1]')}>
        <AlbumTile messageId={row.messageId} index={index} item={item} own={own} />
      </div>
    ))}
  </div>
);

/** M15b: a file row: type icon, name, size and type; Download for a received one, then Open and Save…. */
const FileItem = ({ messageId, index, item, own }: ItemProps) => {
  const { local, ready, fetchNow, askResend, act, actionError } = useItem(messageId, index, item);
  const line = ready ? null : stateLine(local, item, own, fetchNow, askResend);
  return (
    <div className="flex w-72 max-w-full flex-col gap-1" data-testid="attachment-item" data-kind="file" data-status={local?.status ?? 'none'}>
      <div className={cn('flex items-center gap-3 rounded-medium py-2 ps-2 pe-3', own ? 'bg-surface-nested-inverted' : 'bg-surface-container')}>
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-small', own ? 'bg-surface-container-inverted' : 'bg-surface-nested')}>
          <TypeIcon mime={item.mime} name={item.name} className={cn('size-5', own ? 'text-fg-primary-inverted' : 'text-fg-secondary')} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-m" data-testid="attachment-file-name">
            {item.name ?? 'Attachment'}
          </p>
          <p className={cn('text-body-s', own ? 'text-fg-secondary-inverted' : 'text-fg-secondary')}>
            {formatSize(item.size)} · {typeLabel(item.mime, item.name)}
          </p>
        </div>
      </div>
      {line ? <div className={cn('flex', own ? 'justify-end' : 'justify-start')}>{line}</div> : null}
      {ready ? <OpenSave own={own} act={act} /> : null}
      <ActionError text={actionError} />
    </div>
  );
};

const WAVE_BAR = 3;
const WAVE_GAP = 2;
const WAVE_HEIGHT = 28;

/** The sender's waveform as SVG bars; bars left of `progress` (0–1) are drawn played. */
const Waveform = ({ samples, progress, own }: { samples: readonly number[]; progress: number; own: boolean }) => {
  const bars = samples.length > 0 ? samples : new Array<number>(32).fill(0);
  const width = bars.length * (WAVE_BAR + WAVE_GAP) - WAVE_GAP;
  return (
    <svg viewBox={`0 0 ${width} ${WAVE_HEIGHT}`} className="block h-7 w-full" preserveAspectRatio="none" aria-hidden data-testid="voice-waveform">
      {bars.map((value, i) => {
        const height = Math.max(3, Math.round((value / 255) * WAVE_HEIGHT));
        const played = (i + 0.5) / bars.length <= progress;
        return (
          <rect
            key={i}
            x={i * (WAVE_BAR + WAVE_GAP)}
            y={(WAVE_HEIGHT - height) / 2}
            width={WAVE_BAR}
            height={height}
            rx={1.5}
            className={own ? (played ? 'fill-fg-primary-inverted' : 'fill-fg-tertiary-inverted') : played ? 'fill-fg-primary' : 'fill-fg-tertiary'}
          />
        );
      })}
    </svg>
  );
};

/**
 * M15b: the voice player. Play/pause, the waveform as the progress bar (click
 * to seek), elapsed / total. The duration is the message's `durationMs`:
 * MediaRecorder's WebM has no duration in its header.
 */
const VoiceItem = ({ messageId, index, item, own }: ItemProps) => {
  const { local, ready, fetchNow, askResend, act, actionError } = useItem(messageId, index, item);
  const url = useObjectUrl(ready, item.mime.split(';')[0] ?? item.mime);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const durationMs = item.media.kind === 'voice' ? item.media.durationMs : 0;
  const waveform = item.media.kind === 'voice' ? item.media.waveform : [];
  const progress = durationMs > 0 ? Math.min(1, position / durationMs) : 0;
  const line = ready ? null : stateLine(local, item, own, fetchNow, askResend);

  const toggle = () => {
    const player = audio.current;
    if (!player) return;
    if (player.paused) void player.play().catch(() => setPlaying(false));
    else player.pause();
  };
  const seek = (event: MouseEvent<HTMLButtonElement>) => {
    const player = audio.current;
    if (!player || durationMs <= 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
    player.currentTime = (at * durationMs) / 1000;
    setPosition(at * durationMs);
  };

  return (
    <div className="flex w-72 max-w-full flex-col gap-1" data-testid="attachment-item" data-kind="voice" data-status={local?.status ?? 'none'}>
      <div className="flex items-center gap-3 py-1">
        <Button
          type="button"
          size="icon"
          variant={own ? 'secondary' : 'default'}
          className="size-10 shrink-0 rounded-full"
          disabled={!url}
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play voice message'}
          data-testid="voice-play"
        >
          {!url && local?.status === 'downloading' ? <Loader2 className="size-5 animate-spin" /> : playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <button type="button" className="block w-full cursor-pointer disabled:cursor-default" disabled={!url} onClick={seek} aria-label="Seek">
            <Waveform samples={waveform} progress={progress} own={own} />
          </button>
          <p className={cn('text-caption tabular-nums', own ? 'text-fg-secondary-inverted' : 'text-fg-secondary')} data-testid="voice-duration">
            {playing || position > 0 ? `${clockOf(position)} / ${clockOf(durationMs)}` : clockOf(durationMs)}
          </p>
        </div>
      </div>
      {url ? (
        <audio
          ref={audio}
          src={url}
          preload="auto"
          className="hidden"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={event => setPosition(event.currentTarget.currentTime * 1000)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
        />
      ) : null}
      {line ? <div className={cn('flex', own ? 'justify-end' : 'justify-start')}>{line}</div> : null}
      {ready ? (
        <div className={cn('flex', own ? 'justify-end' : 'justify-start')}>
          <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 font-normal" onClick={() => act('save')} data-testid="attachment-save">
            <Download className="size-3.5" aria-hidden /> Save…
          </Button>
        </div>
      ) : null}
      <ActionError text={actionError} />
    </div>
  );
};

/**
 * M15c: a video. Before the download: its poster (thumbnail over the
 * blurhash), a play mark, its duration, and the state chip (with the size). After:
 * inline playback with the stock controls, then Open and Save…. Videos
 * download on a tap (spec 0012: only images and voice notes go on their own).
 */
const VideoItem = ({ messageId, index, item, own }: ItemProps) => {
  const { local, ready, fetchNow, askResend, act, actionError } = useItem(messageId, index, item);
  const url = useObjectUrl(ready, item.mime);
  const poster = useObjectUrl(item.thumbnail, 'image/webp');
  const line = ready ? null : stateLine(local, item, own, fetchNow, askResend);
  const durationMs = item.media.kind === 'video' ? item.media.durationMs : 0;
  return (
    <div className="flex w-72 max-w-full flex-col gap-1" data-testid="attachment-item" data-kind="video" data-status={local?.status ?? 'none'}>
      <div className="relative w-72 max-w-full overflow-hidden rounded-medium bg-surface-container">
        {url ? (
          <video
            src={url}
            poster={poster ?? undefined}
            controls
            preload="metadata"
            className="block h-auto max-h-80 w-full"
            data-testid="attachment-video"
            onLoadedMetadata={event => {
              // A MediaRecorder WebM has no duration in its header: seek to the end once so the controls learn it.
              const player = event.currentTarget;
              if (Number.isFinite(player.duration)) return;
              player.addEventListener('durationchange', () => (player.currentTime = 0), { once: true });
              player.currentTime = Number.MAX_SAFE_INTEGER;
            }}
          />
        ) : (
          <>
            <Placeholder item={item} />
            {poster ? <img src={poster} alt="" className="absolute inset-0 size-full object-cover" /> : null}
            <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
              <span className="flex size-12 items-center justify-center rounded-full bg-surface-container text-fg-primary shadow-1">
                <Play className="size-6" />
              </span>
            </span>
            <span className="absolute end-2 bottom-2">
              <StateChip>
                <span className="tabular-nums" data-testid="video-duration">
                  {clockOf(durationMs)}
                </span>
              </StateChip>
            </span>
            {line ? <div className="absolute start-2 bottom-2">{line}</div> : null}
          </>
        )}
      </div>
      {ready ? <OpenSave own={own} act={act} /> : null}
      <ActionError text={actionError} />
    </div>
  );
};

/**
 * M15c: under the peer's "Please resend …" (spec 0012 "Re-upload on
 * request"): our client offers to store the same ciphertext again from the
 * local copy. The original message's CIDs then work again; no message is sent.
 */
export const ResendOffer = ({ messageId, peer }: { messageId: string; peer: string }) => {
  const service = useService();
  const target = useLiveQuery(async () => {
    const row = await getMessage(messageId);
    if (!row || row.peerAccountId !== peer || row.direction !== 'outgoing' || row.content.type !== 'attachment') return { row: null, copies: false };
    const locals = await Promise.all(row.content.items.map((_item, index) => getAttachmentRow(messageId, index)));
    return { row, copies: locals.every(local => local?.bytes) };
  }, [messageId, peer]);
  const [state, setState] = useState<{ phase: 'idle' | 'busy' | 'done' | 'error'; text: string | null }>({ phase: 'idle', text: null });
  if (!target?.row || target.row.content.type !== 'attachment') return null;
  const [first] = target.row.content.items;
  const what = first ? resendName(first) : 'the attachment';
  if (!target.copies) {
    return (
      <p className="text-caption text-fg-tertiary" data-testid="resend-offer">
        The file is no longer on this computer, so it cannot be resent.
      </p>
    );
  }
  const run = () => {
    if (!service) return;
    setState({ phase: 'busy', text: null });
    service
      .resend(messageId)
      .then(result =>
        setState({
          phase: 'done',
          text: result.submitted === 0 ? 'Still on the Bulletin chain: nothing to store again.' : `Stored again (${result.submitted} of ${result.chunks} chunks). Their copy works for 14 days.`,
        }),
      )
      .catch((cause: unknown) => setState({ phase: 'error', text: cause instanceof Error ? cause.message : 'That did not work.' }));
  };
  return (
    <div className="flex flex-col items-start gap-1" data-testid="resend-offer">
      <Button size="sm" variant="secondary" className="h-7 rounded-full px-3 font-normal" disabled={!service || state.phase === 'busy'} onClick={run} data-testid="resend-run">
        {state.phase === 'busy' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCcw className="size-3.5" aria-hidden />}
        {state.phase === 'busy' ? 'Storing again…' : `Resend ${what}`}
      </Button>
      {state.text ? (
        <p className={cn('text-caption', state.phase === 'error' ? 'text-fg-error' : 'text-fg-secondary')} data-testid="resend-result">
          {state.text}
        </p>
      ) : null}
    </div>
  );
};

/**
 * HOP receive: a phone app's `richText` attachments in the same bubbles as a
 * Bulletin attachment (image, video, file row), then the text. An
 * attachment without a node and ticket (a row from before HOP receive, or a
 * variant this app does not know) keeps the old line.
 */
export const HopAttachmentBody = ({ row, own }: { row: MessageRow; own: boolean }) => {
  if (row.content.type !== 'richText') return null;
  const { attachments, text } = row.content;
  return (
    <div className="flex flex-col gap-2" data-testid="attachment" data-via="hop">
      {attachments.map((attachment, index) => {
        if (!attachment.hop) {
          return (
            <p key={index} className={cn('text-body-s', own ? 'text-fg-secondary-inverted' : 'text-fg-secondary')}>
              This message can only be viewed in the mobile app
            </p>
          );
        }
        const item = hopItemOf(attachment);
        const View = item.media.kind === 'image' ? ImageItem : item.media.kind === 'video' && isVideoType(item.mime) ? VideoItem : FileItem;
        return <View key={index} messageId={row.messageId} index={index} item={item} own={own} />;
      })}
      {text ? <p className="text-body-m whitespace-pre-wrap">{text}</p> : null}
      {/* M20b: a file this app sent over HOP lives on the node for a day. */}
      {own && attachments.some(attachment => attachment.hop?.node) ? (
        <p className="text-body-s text-fg-secondary-inverted" data-testid="hop-sent">
          {HOP_SENT_LINE}
        </p>
      ) : null}
    </div>
  );
};

/** The body of a kind-250 bubble: an album grid, or each item by its kind; then the caption. */
export const AttachmentBody = ({ row, own }: { row: MessageRow; own: boolean }) => {
  if (row.content.type !== 'attachment') return null;
  const { items, caption } = row.content;
  const album = items.length > 1 && items.every(item => item.media.kind === 'image');
  return (
    <div className="flex flex-col gap-2" data-testid="attachment">
      {album ? (
        <AlbumGrid row={row} items={items} own={own} />
      ) : (
        items.map((item, index) => {
          const View = item.media.kind === 'image' ? ImageItem : item.media.kind === 'voice' ? VoiceItem : item.media.kind === 'video' && isVideoType(item.mime) ? VideoItem : FileItem;
          return <View key={index} messageId={row.messageId} index={index} item={item} own={own} />;
        })
      )}
      {caption ? <p className="text-body-m whitespace-pre-wrap">{caption}</p> : null}
    </div>
  );
};
