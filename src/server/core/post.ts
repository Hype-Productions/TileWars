import { reddit } from '@devvit/web/server';
import { EntrypointHeight } from '@devvit/reddit';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    title: 'Daily Tile Wars',
    entry: 'default',
    styles: {
      backgroundColor: '#F6F0E8FF',
      backgroundColorDark: '#101820FF',
      height: EntrypointHeight.TALL,
    },
  });
};
