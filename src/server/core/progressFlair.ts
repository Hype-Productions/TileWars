import { context, reddit } from '@devvit/web/server';
import {
  progressFlairFor,
  type PlayerProgressSummary,
} from '../../shared/progression';

export const syncCurrentUserProgressFlair = async (
  progress: PlayerProgressSummary
): Promise<void> => {
  const username = context.username;
  const subredditName = context.subredditName;
  if (!username || !subredditName) {
    return;
  }

  try {
    const desired = progressFlairFor(progress);
    const user = await reddit.getUserByUsername(username);
    const current = await user?.getUserFlairBySubreddit(subredditName);
    if (current?.flairText === desired.text) {
      return;
    }

    await reddit.setUserFlair({
      subredditName,
      username,
      text: desired.text,
      backgroundColor: desired.backgroundColor,
      textColor: desired.textColor,
    });
  } catch (error) {
    console.warn('Unable to synchronize TILEWARS user flair.', error);
  }
};
