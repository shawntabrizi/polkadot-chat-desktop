import { type FormEvent, useState } from 'react';

import { bytesToHex } from '../app/bytes';
import { db } from '../app/database';
import type { NetworkProfile } from '../app/network';
import type { ChatManager } from '../domain/chat/manager';
import type { IdentityLookup } from '../domain/identity/lookup';
import { type SearchResult, searchUsernames } from '../domain/identity/search';

import { useLiveQuery } from './useLiveQuery';

type Props = {
  profile: NetworkProfile;
  selfIdentityAccountId: Uint8Array;
  lookup: IdentityLookup;
  manager: ChatManager;
};

export const Search = ({ profile, selfIdentityAccountId, lookup, manager }: Props) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contacts = useLiveQuery(() => db.contacts.toArray(), []);
  const requests = useLiveQuery(() => db.requests.toArray(), []);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const prefix = query.trim();
    if (!prefix) return;
    setError(null);
    setBusy('search');
    try {
      setResults(await searchUsernames(profile, prefix, selfIdentityAccountId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Search failed.');
    } finally {
      setBusy(null);
    }
  };

  const sendRequest = async (result: SearchResult) => {
    setError(null);
    setBusy(result.candidateAccountId);
    try {
      const peer = await lookup.getPeerIdentity(result.accountId);
      if (!peer) throw new Error(`${result.username} has no chat key on the People chain yet.`);
      await manager.sendRequest(peer, null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send the request.');
    } finally {
      setBusy(null);
    }
  };

  const stateOf = (result: SearchResult): string | null => {
    const key = bytesToHex(result.accountId);
    if (contacts?.some(contact => contact.accountId === key)) return 'contact';
    const request = requests?.find(row => row.peerAccountId === key && row.status === 'pending');
    if (request) return request.direction === 'outgoing' ? 'request sent' : 'request received';
    return null;
  };

  return (
    <section>
      <h2>Find people</h2>
      <form onSubmit={event => void search(event)}>
        <input
          type="search"
          value={query}
          placeholder="Username"
          onChange={event => setQuery(event.target.value)}
          aria-label="Username"
        />{' '}
        <button type="submit" disabled={busy !== null}>
          Search
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {results?.length === 0 ? <p>No usernames start with “{query.trim()}”.</p> : null}
      <ul>
        {results?.map(result => {
          const state = stateOf(result);
          return (
            <li key={result.candidateAccountId} style={{ margin: '8px 0' }}>
              <strong>{result.username}</strong> <code>{result.candidateAccountId}</code>{' '}
              {state ? (
                <em>({state})</em>
              ) : (
                <button type="button" disabled={busy !== null} onClick={() => void sendRequest(result)}>
                  Send request
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
