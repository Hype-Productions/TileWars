import { getShareData } from '@devvit/web/client';
import {
  parseVersusShareData,
  parseVersusShareUrl,
  type VersusShareData,
} from '../shared/versus';

export const readVersusShareData = (): VersusShareData | null => {
  const sdkValue = parseVersusShareData(getShareData());
  if (sdkValue) {
    return sdkValue;
  }
  return (
    parseVersusShareUrl(window.location.href) ??
    parseVersusShareUrl(document.referrer)
  );
};
