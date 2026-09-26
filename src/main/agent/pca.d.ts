// Types for the parts of pca bot-core (the `polkadot-chat-agents` package,
// vendor/polkadot-chat-agents-bot-core-675f948-p289d02c.tgz) this app imports. The
// package ships plain ESM without types.

declare module 'polkadot-chat-agents/lib/agent-context.mjs' {
  /** Spec 0006: the buttons MUST wording pca gives every bot whose peers render buttons. */
  export const BUTTONS_HINT: string;
  export function buildOperatorContext(options: {
    username?: string;
    transport?: string;
    policy?: { capabilities: readonly string[]; scope?: string };
    model?: string;
    modelPolicy?: readonly string[] | null;
    commands?: readonly { command: string; meaning: string }[];
    buttons?: boolean;
    group?: { name: string; size: number } | null;
    docsUrl?: string;
  }): string;
}

declare module 'polkadot-chat-agents/lib/buttons-block.mjs' {
  export function extractButtonsBlock(reply: unknown): { text: string; rows: unknown[][] | null; oneShot: boolean; invalid: string[] } | null;
}
