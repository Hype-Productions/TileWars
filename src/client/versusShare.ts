import { getShareData } from '@devvit/web/client';
import {
  parseVersusShareData,
  parseVersusShareUrl,
  type VersusShareData,
} from '../shared/versus';

const INVITE_INTENT_KEY = 'tilewars:versus-invite-intent';
const INVITE_INTENT_MAX_AGE_MS = 10 * 60 * 1000;
const HANDLED_INVITE_KEY_PREFIX = 'tilewars:handled-versus-invite:';
const HANDLED_INVITE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export type VersusInviteIntent = VersusShareData & {
  action: 'accept';
  createdAt: number;
};

export const readVersusShareData = (): VersusShareData | null => {
  let sdkValue: VersusShareData | null = null;
  try {
    sdkValue = parseVersusShareData(getShareData());
  } catch {
    // Static previews do not install Reddit's share-data bridge.
  }
  if (sdkValue) {
    return sdkValue;
  }
  return (
    parseVersusShareUrl(window.location.href) ??
    parseVersusShareUrl(document.referrer)
  );
};

export const rememberVersusInviteIntent = (inviteId: string): void => {
  const value: VersusInviteIntent = {
    type: 'pattern-invite',
    inviteId,
    action: 'accept',
    createdAt: Date.now(),
  };
  const serialized = JSON.stringify(value);
  for (const storage of availableStorages()) {
    try {
      storage.setItem(INVITE_INTENT_KEY, serialized);
    } catch {
      // The other storage or the Devvit share envelope can still carry the invite.
    }
  }
};

export const consumeVersusInviteIntent = (): VersusInviteIntent | null => {
  let intent: VersusInviteIntent | null = null;
  for (const storage of availableStorages()) {
    try {
      const raw = storage.getItem(INVITE_INTENT_KEY);
      storage.removeItem(INVITE_INTENT_KEY);
      const parsed = parseInviteIntent(raw);
      if (parsed && (!intent || parsed.createdAt > intent.createdAt)) {
        intent = parsed;
      }
    } catch {
      // Storage can be disabled in embedded browsers.
    }
  }
  return intent;
};

export const clearVersusInviteIntent = (): void => {
  for (const storage of availableStorages()) {
    try {
      storage.removeItem(INVITE_INTENT_KEY);
    } catch {
      // Storage can be disabled in embedded browsers.
    }
  }
};

export const markVersusInviteHandled = (inviteId: string): void => {
  const key = `${HANDLED_INVITE_KEY_PREFIX}${inviteId}`;
  const handledAt = String(Date.now());
  for (const storage of availableStorages()) {
    try {
      storage.setItem(key, handledAt);
    } catch {
      // The other storage can still suppress the already handled invitation.
    }
  }
};

export const wasVersusInviteHandled = (inviteId: string): boolean => {
  const key = `${HANDLED_INVITE_KEY_PREFIX}${inviteId}`;
  for (const storage of availableStorages()) {
    try {
      const handledAt = Number(storage.getItem(key));
      if (
        Number.isFinite(handledAt) &&
        handledAt > 0 &&
        Date.now() - handledAt <= HANDLED_INVITE_MAX_AGE_MS
      ) {
        return true;
      }
      storage.removeItem(key);
    } catch {
      // Storage can be disabled in embedded browsers.
    }
  }
  return false;
};

const availableStorages = (): Storage[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  const storages: Storage[] = [];
  try {
    storages.push(window.sessionStorage);
  } catch {
    // Ignore unavailable session storage.
  }
  try {
    storages.push(window.localStorage);
  } catch {
    // Ignore unavailable local storage.
  }
  return storages;
};

const parseInviteIntent = (raw: string | null): VersusInviteIntent | null => {
  if (!raw) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('type' in value) ||
      !('inviteId' in value) ||
      !('action' in value) ||
      !('createdAt' in value) ||
      value.type !== 'pattern-invite' ||
      typeof value.inviteId !== 'string' ||
      value.action !== 'accept' ||
      typeof value.createdAt !== 'number' ||
      Date.now() - value.createdAt > INVITE_INTENT_MAX_AGE_MS
    ) {
      return null;
    }
    return {
      type: 'pattern-invite',
      inviteId: value.inviteId,
      action: 'accept',
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
};
