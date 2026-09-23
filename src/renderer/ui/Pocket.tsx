// M11b step 2: your balance, always visible. The chip sits next to the
// username in the left pane's footer; a click opens the Pocket in the right
// pane (never a modal, design system §10): the balance on each chain this app
// uses, the address with Copy and a QR code (the person opened this view to
// see it, §11), and "Get test funds", which opens the Faucet chat.
//
// Flat, no gradient (docs/decisions.md M11b): the balances are rows of
// values, and the QR code must keep full contrast to scan.

import { Check, Copy, Droplets, Wallet } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { getPeopleConnection } from '../app/statementStore';
import { readPeopleFree } from '../domain/chain/balances';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import { formatPas } from '../../shared/balanceHint';

import { QrCode } from './QrCode';
import { useAssetHubBalance, useBestBlock } from './useChain';

/** The footer chip: "12.3 PAS" in mono, or a quiet dash until the first read. */
export const BalanceChip = ({ active, onOpen }: { active: boolean; onOpen: () => void }) => {
  const { free, error } = useAssetHubBalance();
  const text = free !== null ? formatPas(free) : error ? 'Balance unknown' : '… PAS';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={active}
      aria-label={`Pocket: ${text}`}
      data-testid="balance-chip"
      className={cn(
        'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-action-tertiary px-2.5 py-1 text-label-s text-fg-primary transition-colors hover:bg-action-tertiary-hover',
        active && 'bg-selection-container-active',
      )}
    >
      <Wallet className="size-3.5 text-fg-secondary" aria-hidden />
      <span className="font-mono">{text}</span>
    </button>
  );
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-4 rounded-container bg-surface-container p-5 shadow-1">
    <h2 className="text-heading-s text-fg-primary">{title}</h2>
    {children}
  </section>
);

/** One chain: its name and the balance, the same style on both sides (§7 "Rows and Cells"). */
const BalanceRow = ({ chain, testId, children }: { chain: string; testId: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 px-5 py-3 transition-colors hover:bg-selection-container-hover" data-testid={testId}>
    <span className="text-body-m text-fg-primary">{chain}</span>
    <span className="text-body-m text-fg-primary">{children}</span>
  </div>
);

type Props = {
  username: string;
  /** SS58 (prefix 42): the account on every chain. */
  address: string;
  profileId: NetworkProfileId;
  onGetFunds: () => void;
};

export const Pocket = ({ username, address, profileId, onGetFunds }: Props) => {
  const assetHub = useAssetHubBalance();
  const block = useBestBlock();
  const [people, setPeople] = useState<{ free: bigint | null; error: boolean }>({ free: null, error: false });
  const [copied, setCopied] = useState(false);

  // The People chain: read when the Pocket opens, and again with each Asset Hub block while it stays open.
  useEffect(() => {
    let active = true;
    readPeopleFree(getPeopleConnection(NETWORK_PROFILES[profileId]), address).then(
      free => {
        if (active) setPeople({ free, error: false });
      },
      (cause: unknown) => {
        console.warn('[pocket] people balance read failed', cause);
        if (active) setPeople(current => ({ ...current, error: current.free === null }));
      },
    );
    return () => {
      active = false;
    };
  }, [address, profileId, block]);

  const amount = (state: { free: bigint | null; error: boolean }, empty?: string) =>
    state.free === null ? (
      <span className="text-fg-secondary">{state.error ? 'Cannot read now' : 'Reading…'}</span>
    ) : state.free === 0n && empty ? (
      <span className="text-fg-secondary">{empty}</span>
    ) : (
      <span className="font-mono">{formatPas(state.free)}</span>
    );

  return (
    <div className="h-full overflow-y-auto" data-testid="pocket">
      <div className="mx-auto flex max-w-2xl flex-col gap-2 pb-2">
        <div className="flex flex-col gap-1 px-5 pt-4 pb-2">
          <h1 className="text-heading-l text-fg-primary">Pocket</h1>
          <p className="text-body-m text-fg-secondary">
            {username} · {NETWORK_PROFILES[profileId].label}
          </p>
        </div>
        <section className="flex flex-col overflow-hidden rounded-container bg-surface-container py-2 shadow-1" aria-label="Balances">
          <h2 className="px-5 pt-3 pb-1 text-heading-s text-fg-primary">Balances</h2>
          <BalanceRow chain="Asset Hub" testId="pocket-asset-hub">
            {amount(assetHub)}
          </BalanceRow>
          <BalanceRow chain="People chain" testId="pocket-people">
            {amount(people, 'No balance needed')}
          </BalanceRow>
        </section>
        <Section title="Your address">
          <div className="flex items-start gap-5">
            <div className="shrink-0 overflow-hidden rounded-nested bg-surface-nested p-2">
              <QrCode value={address} size={144} alt="QR code of your address" />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-body-m font-mono break-all text-fg-primary" data-testid="pocket-address">
                {address}
              </p>
              <p className="text-body-s text-fg-secondary">The same address on Asset Hub and the People chain. Test funds on this network have no value.</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="w-fit cursor-pointer rounded-medium text-label-m"
                  data-testid="pocket-copy"
                  onClick={() => {
                    void navigator.clipboard.writeText(address).then(() => setCopied(true));
                  }}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button variant="secondary" className="w-fit cursor-pointer rounded-medium text-label-m" data-testid="pocket-get-funds" onClick={onGetFunds}>
                  <Droplets aria-hidden />
                  Get test funds
                </Button>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
};
