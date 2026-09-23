// Ported from polkadot-desktop src/domains/chat/p2p/requests/schemas.ts.
// The multi-device session envelope (`StructuredStatementData`) is not ported:
// @novasamatech/statement-store owns it (`StatementData`).

/**
 * SCALE codecs for the chat request wire format. Must match iOS
 * (RemoteChatRequestMessage.swift, ChatRequestFactory.swift) and Android
 * (ChatRequestRemoteModel.kt, IdentityProofCodec.kt).
 *
 *   RequestContentV2 {
 *     identityProof:   { identityAccountId(32), proof(32) },
 *     deviceEncPubKey: Bytes(32),           // sender device X25519 pub
 *     pushToken:       Option<TokenContent>,
 *     welcomeMessage:  Option<RichTextContent>,
 *   }
 *
 * `proof = kHash(K(A,B), SCALE(IdentityProofPayload))` where
 * `K(A,B) = ECDH(senderIdentityChatPriv, recipientIdentityChatPub)`. The
 * receiver holds the recipient identity chat private key, recomputes the same
 * K and compares (mds.md §"Chat Requests").
 */

import { RichTextContent, TokenContent } from '@novasamatech/host-chat/codec/message';
import { Bytes, Enum, Option, Struct, str, u64 } from 'scale-ts';

const AccountIdCodec = Bytes(32);
const PublicKeyCodec = Bytes(32);

export const RequestContentV1 = Struct({
  pushToken: Option(TokenContent),
  welcomeMessage: Option(RichTextContent),
});

/** Binds the kHash to this use; must match Android `IdentityProofCodec.CHAT_REQUEST_CONTEXT`. */
export const IDENTITY_PROOF_CONTEXT = 'mds-chat-request';

export const IdentityProofPayload = Struct({
  identityAccountId: AccountIdCodec,
  statementAccountId: AccountIdCodec,
  context: str,
});

export const IdentityProof = Struct({
  identityAccountId: AccountIdCodec,
  proof: Bytes(32),
});

export const RequestContentV2 = Struct({
  identityProof: IdentityProof,
  deviceEncPubKey: PublicKeyCodec,
  pushToken: Option(TokenContent),
  welcomeMessage: Option(RichTextContent),
});

export const VersionedRequestContent = Enum({
  v1: RequestContentV1,
  v2: RequestContentV2,
});

export const RequestMessage = Struct({
  messageId: str,
  timestamp: u64,
  content: VersionedRequestContent,
});

export const StatementProofCodec = Enum({
  sr25519: Struct({ signature: Bytes(64), signer: Bytes(32) }),
  ed25519: Struct({ signature: Bytes(64), signer: Bytes(32) }),
});

/** What the inner sr25519 signature covers: the message plus the recipient. */
export const ProofPayload = Struct({
  message: RequestMessage,
  requestAcceptorId: Bytes(),
});

export const RemoteModel = Struct({
  message: RequestMessage,
  proof: StatementProofCodec,
});

/** Statement data: an ephemeral X25519 key and the ChaCha20-Poly1305 ciphertext of `RemoteModel`. */
export const EncryptedRemoteModel = Struct({
  encryptionPubKey: Bytes(),
  encryptedData: Bytes(),
});
