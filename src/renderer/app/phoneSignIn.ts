/**
 * M10a: is this session signed in with the Polkadot app on a phone? Then this
 * machine holds no seed, and the UI shows `PHONE_SIGNED_IN` where a seed is
 * needed (wallet signing, recovery phrase, published agent, faucet drip,
 * payments) instead of a failure. Set once per start by App.tsx, from the
 * saved identity's summary; read where `isWeb()` is read.
 */

let phone = false;

export const setPhoneSignIn = (value: boolean): void => {
  phone = value;
};

export const isPhoneSignIn = (): boolean => phone;
