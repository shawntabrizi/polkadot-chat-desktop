// Adapted from polkadot-desktop src/shared/components/QrCode/QrCode.tsx.

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

type Props = {
  value: string;
  size: number;
};

/**
 * Encoding is async and `value` can change while a render is in flight, so a
 * result whose request was superseded is dropped.
 */
export const QrCode = ({ value, size }: Props) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then(url => {
        if (active) setDataUrl(url);
      })
      .catch((error: unknown) => {
        console.error('[qr] failed to encode', error);
        if (active) setDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  // Hold the box before the first encode lands so the layout does not jump.
  if (!dataUrl) return <div style={{ width: size, height: size }} />;
  return <img src={dataUrl} width={size} height={size} alt="Pairing QR code" />;
};
