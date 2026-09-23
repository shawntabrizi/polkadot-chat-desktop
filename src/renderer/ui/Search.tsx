// Draft room from .refs/polkadot-desktop/src/features/chat/ui/partials/DraftInvitationRoom.tsx
// (2026-09-23); strings from docs/reference/mobile-ux.md "Starting a chat".

import { ArrowLeft, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type HexString, bytesToHex } from '../app/bytes';
import { db } from '../app/database';
import type { NetworkProfile } from '../app/network';
import type { ChatManager } from '../domain/chat/manager';
import type { IdentityLookup } from '../domain/identity/lookup';
import { type SearchResult, searchUsernames } from '../domain/identity/search';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { PeerAvatar } from './Avatar';
import { ChatRow } from './ChatRow';
import { RoomHeader } from './RoomHeader';
import { plainError } from './format';
import { useLiveQuery } from './useLiveQuery';

/** Wait for a pause in typing: each search mines a proof of work first. */
const SEARCH_DELAY_MS = 500;

type SearchState =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'done'; query: string; results: SearchResult[] }
  | { state: 'failed'; message: string };

type PanelProps = {
  profile: NetworkProfile;
  selfIdentityAccountId: Uint8Array;
  onBack: () => void;
  onPick: (result: SearchResult) => void;
};

/** The left pane while "New chat" is open: find a username on the network. */
export const NewChatPanel = ({ profile, selfIdentityAccountId, onBack, onPick }: PanelProps) => {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState>({ state: 'idle' });
  const contacts = useLiveQuery(() => db.contacts.toArray(), []);
  const requests = useLiveQuery(() => db.requests.toArray(), []);

  useEffect(() => {
    const prefix = query.trim().toLowerCase();
    let active = true;
    const timer = setTimeout(() => {
      if (!prefix) {
        setSearch({ state: 'idle' });
        return;
      }
      setSearch({ state: 'searching' });
      searchUsernames(profile, prefix, selfIdentityAccountId)
        .then(results => {
          if (active) setSearch({ state: 'done', query: prefix, results });
        })
        .catch((cause: unknown) => {
          if (active) setSearch({ state: 'failed', message: `${plainError(cause, 'The search did not finish.')} Check your connection and try again.` });
        });
    }, SEARCH_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, profile, selfIdentityAccountId]);

  const stateOf = (result: SearchResult): string => {
    const key = bytesToHex(result.accountId);
    if (contacts?.some(contact => contact.accountId === key)) return 'In your chats';
    const request = requests?.find(row => row.peerAccountId === key && row.status === 'pending');
    if (request) return request.direction === 'outgoing' ? 'Request message sent' : 'Message request';
    return 'Start a chat';
  };

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" className="rounded-full font-normal" aria-label="Back to chats" onClick={onBack}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-heading-m text-fg-primary">New chat</h1>
      </div>
      <Input
        autoFocus
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Type username"
        aria-label="Username"
        autoComplete="off"
        spellCheck={false}
        className="mb-2 h-10 rounded-nested px-2 text-body-m md:text-body-m"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" data-testid="search-results">
        {search.state === 'searching' ? <p className="px-2 py-4 text-body-s text-fg-tertiary">Searching…</p> : null}
        {search.state === 'failed' ? (
          <p role="alert" className="px-2 py-4 text-body-s text-fg-error">
            {search.message}
          </p>
        ) : null}
        {search.state === 'done' && search.results.length === 0 ? (
          <p className="px-2 py-4 text-center text-body-s text-fg-secondary">No results for “{search.query}”</p>
        ) : null}
        {search.state === 'done'
          ? search.results.map(result => (
              <ChatRow
                key={result.candidateAccountId}
                avatar={<PeerAvatar name={result.username} />}
                name={result.username}
                time={null}
                preview={stateOf(result)}
                unread={0}
                selected={false}
                onClick={() => onPick(result)}
              />
            ))
          : null}
      </div>
    </>
  );
};

type DraftProps = {
  result: SearchResult;
  lookup: IdentityLookup | null;
  manager: ChatManager | null;
  /** The request is out; the caller opens the pending room. */
  onSent: (peer: HexString) => void;
};

/** The right pane for someone new: one message goes with the request. */
export const DraftRoom = ({ result, lookup, manager, onSent }: DraftProps) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = result.username;

  const send = async () => {
    if (!lookup || !manager) return;
    setError(null);
    setBusy(true);
    try {
      const peer = await lookup.getPeerIdentity(result.accountId);
      if (!peer) throw new Error(`${name} has no chat key on the People chain yet, so a request cannot reach them. Try again later.`);
      await manager.sendRequest(peer, text.trim() || null);
      onSent(bytesToHex(result.accountId));
    } catch (cause) {
      setError(plainError(cause, 'The request was not sent. Check your connection and try again.'));
      setBusy(false);
    }
  };

  return (
    <>
      <RoomHeader avatar={<PeerAvatar name={name} />} name={name} />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <div className="mb-3 rounded-full bg-surface-nested p-4">
          <UserPlus className="size-6 text-fg-tertiary" aria-hidden />
        </div>
        <p className="text-heading-m text-fg-primary">Invite {name} to chat</p>
        <p className="text-body-m text-fg-secondary">You can only send one message in this request.</p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-4 pt-2 pb-4">
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={event => setText(event.target.value)}
            rows={1}
            placeholder="Say hello... (optional)"
            aria-label="Message"
            disabled={busy}
            className="max-h-40 min-h-10 resize-none rounded-nested py-2 text-body-m md:text-body-m"
          />
          <Button className="h-auto w-fit shrink-0 rounded-full px-8 py-2.5 text-label-l" disabled={busy || !manager} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send Request'}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-body-s text-fg-error">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
};
