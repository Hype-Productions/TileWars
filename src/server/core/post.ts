import { reddit, redis } from '@devvit/web/server';
import { EntrypointHeight } from '@devvit/reddit';

const DAILY_RESULTS_THREAD_TEXT = [
  '📌 TILEWARS Daily Results',
  'Finished today’s pattern? Use the game’s Post Result button to share your score as a reply here.',
].join('\n\n');

const resultsThreadKeys = {
  comment: (postId: string): string => `post:${postId}:daily-results-comment`,
  ready: (postId: string): string => `post:${postId}:daily-results-ready`,
  lock: (postId: string): string => `post:${postId}:daily-results-lock`,
};

type RedditPostId = `t3_${string}`;
type RedditCommentId = `t1_${string}`;

export const createPost = async () => {
  const post = await reddit.submitCustomPost({
    title: 'Daily Tile Wars',
    entry: 'default',
    styles: {
      backgroundColor: '#F6F0E8FF',
      backgroundColorDark: '#101820FF',
      height: EntrypointHeight.TALL,
    },
  });

  try {
    await ensureDailyResultsThread(post.id);
  } catch (error) {
    console.error('Could not prepare the Daily results thread:', {
      postId: post.id,
      error,
    });
  }

  return post;
};

export const ensureDailyResultsThread = async (
  postId: RedditPostId
): Promise<RedditCommentId> => {
  const commentKey = resultsThreadKeys.comment(postId);
  const readyKey = resultsThreadKeys.ready(postId);
  const existingCommentId = await redis.get(commentKey);

  if (
    isRedditCommentId(existingCommentId) &&
    (await redis.get(readyKey)) === existingCommentId
  ) {
    return existingCommentId;
  }

  const lockKey = resultsThreadKeys.lock(postId);
  const claimed = await redis.set(lockKey, 'creating', {
    nx: true,
    expiration: new Date(Date.now() + 30_000),
  });

  if (!claimed) {
    const concurrentCommentId = await redis.get(commentKey);
    if (
      isRedditCommentId(concurrentCommentId) &&
      (await redis.get(readyKey)) === concurrentCommentId
    ) {
      return concurrentCommentId;
    }
    throw new Error('The results thread is being prepared. Try again.');
  }

  try {
    const storedCommentId = await redis.get(commentKey);
    if (isRedditCommentId(storedCommentId)) {
      const storedComment = await reddit.getCommentById(storedCommentId);
      await storedComment.distinguish(true);
      await redis.set(readyKey, storedCommentId);
      return storedCommentId;
    }

    const comment = await reddit.submitComment({
      id: postId,
      text: DAILY_RESULTS_THREAD_TEXT,
      runAs: 'APP',
    });
    await redis.set(commentKey, comment.id);
    await comment.distinguish(true);
    await redis.set(readyKey, comment.id);
    return comment.id;
  } finally {
    await redis.del(lockKey);
  }
};

const isRedditCommentId = (
  value: string | undefined
): value is RedditCommentId => value?.startsWith('t1_') === true;
