import { reddit } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect, vi } from 'vitest';
import { app } from '../app';

/**
 * Scenario test harness. `@devvit/test` supplies the request context, Redis and
 * scheduler; the Reddit APIs it does not mock yet (flair, wiki, modmail, listings,
 * moderators) are backed by the in-memory `FakeReddit` below.
 */

export const SUBREDDIT = 'testsub';
export const APP_USER = { username: 'penpal-confirmation', id: 't2_app' };

export const test = createDevvitTest({ subredditName: SUBREDDIT });

export const flairText = (emails: number, letters: number) =>
  `📧 Emails: ${emails} | 📬 Letters: ${letters}`;

/** Wiki pages for the templates that ship unset. */
export const WIKI_TEMPLATES = {
  confirmation_message: 'Updated u/{mentioned_name} from {old_flair} to {new_flair}',
  cant_update_yourself: 'You cannot confirm yourself.',
  user_doesnt_exist: 'u/{mentioned_name} does not exist.',
  monthly_post_title: '%B %Y Confirmation Thread',
  monthly_post: 'Last month: {previous_month_submission.permalink}',
};

const templateText = '📧 Emails: {E} | 📬 Letters: {L}';

type FakeUser = { username: string; id: string; flairText?: string; flairCssClass?: string };

type FakeComment = {
  id: string;
  postId: string;
  parentId: string;
  body: string;
  authorName: string;
  permalink: string;
  stickied: boolean;
  removed: boolean;
};

export type FakePost = {
  id: string;
  title: string;
  text: string;
  authorName: string;
  subredditName: string;
  createdAt: Date;
  stickied: boolean;
  locked: boolean;
  permalink: string;
  url: string;
  flairId?: string;
  suggestedSort?: string;
};

type Failure = Error | undefined;

export class FakeReddit {
  readonly users = new Map<string, FakeUser>();
  readonly wiki = new Map<string, string>();
  flairTemplates = [
    { id: 'tpl-new', text: `0-9:${templateText}`, modOnly: false },
    { id: 'tpl-regular', text: `10-99:${templateText}`, modOnly: false },
    { id: 'tpl-mod', text: `0-999:${templateText}`, modOnly: true },
    { id: 'tpl-star', text: `🌟 ${templateText}`, modOnly: false },
  ];
  moderators: string[] = [];
  readonly posts: FakePost[] = [];
  readonly comments: FakeComment[] = [];

  readonly replies: { parentId: string; text: string }[] = [];
  readonly flairUpdates: {
    username: string;
    flairTemplateId?: string | undefined;
    text?: string | undefined;
    cssClass?: string | undefined;
  }[] = [];
  readonly modNotifications: { subject: string; bodyMarkdown: string }[] = [];
  readonly modmailReplies: { conversationId: string; body: string; isInternal: boolean }[] = [];
  readonly modmailMessages = new Map<string, { bodyMarkdown: string; isInternal: boolean }>();

  /** Make flair writes for these users fail until removed. */
  readonly failFlairFor = new Set<string>();
  /** Errors to throw from the next reply / comment listing calls. */
  replyFailures: Failure[] = [];
  listingFailures: Failure[] = [];

  private nextId = 1;

  constructor() {
    for (const [name, content] of Object.entries(WIKI_TEMPLATES)) {
      this.wiki.set(`confirmation-bot/${name}`, content);
    }
    this.addUser(APP_USER.username, {}, APP_USER.id);
    this.install();
  }

  addUser(username: string, flair: { text?: string; cssClass?: string } = {}, id?: string) {
    const user: FakeUser = {
      username,
      id: id ?? `t2_${username}`,
      ...(flair.text === undefined ? {} : { flairText: flair.text }),
      ...(flair.cssClass === undefined ? {} : { flairCssClass: flair.cssClass }),
    };
    this.users.set(username.toLowerCase(), user);
    return user;
  }

  user(username: string): FakeUser {
    const user = this.users.get(username.toLowerCase());
    if (!user) throw new Error(`No fake user ${username}`);
    return user;
  }

  addPost(post: Partial<FakePost> = {}): FakePost {
    const id = post.id ?? `t3_post${this.nextId++}`;
    const created: FakePost = {
      id,
      title: 'Confirmation Thread',
      text: '',
      authorName: APP_USER.username,
      subredditName: SUBREDDIT,
      createdAt: new Date(),
      stickied: false,
      locked: false,
      permalink: `/r/${SUBREDDIT}/comments/${id.slice(3)}/`,
      url: `https://www.reddit.com/r/${SUBREDDIT}/comments/${id.slice(3)}/`,
      ...post,
    };
    this.posts.unshift(created);
    return created;
  }

  /** Adds a comment to a thread and returns the matching CommentSubmit trigger payload. */
  addComment(
    postId: string,
    authorName: string,
    body: string,
    options: { parentId?: string } = {}
  ) {
    const id = `t1_c${this.nextId++}`;
    const comment: FakeComment = {
      id,
      postId,
      parentId: options.parentId ?? postId,
      body,
      authorName,
      permalink: `/r/${SUBREDDIT}/comments/${postId.slice(3)}/_/${id.slice(3)}/`,
      stickied: false,
      removed: false,
    };
    this.comments.unshift(comment);
    const author = this.users.get(authorName.toLowerCase());
    const post = this.posts.find((candidate) => candidate.id === postId);
    return {
      comment: {
        id: comment.id,
        postId: comment.postId,
        parentId: comment.parentId,
        body: comment.body,
        permalink: comment.permalink,
        deleted: false,
        spam: false,
      },
      author: { name: authorName, id: author?.id ?? `t2_${authorName}` },
      post: {
        id: postId,
        authorId: post?.authorName === APP_USER.username ? APP_USER.id : 't2_op',
      },
      subreddit: { name: SUBREDDIT },
    };
  }

  repliesTo(commentId: string): string[] {
    return this.replies.filter((reply) => reply.parentId === commentId).map((reply) => reply.text);
  }

  private postModel(post: FakePost) {
    return {
      ...post,
      sticky: async () => {
        post.stickied = true;
      },
      unsticky: async () => {
        post.stickied = false;
      },
      lock: async () => {
        post.locked = true;
      },
      setSuggestedCommentSort: async (sort: string) => {
        post.suggestedSort = sort;
      },
    };
  }

  private userModel(user: FakeUser) {
    return {
      username: user.username,
      id: user.id,
      getUserFlairBySubreddit: async () => ({
        flairText: user.flairText,
        flairCssClass: user.flairCssClass,
      }),
    };
  }

  private install() {
    vi.spyOn(reddit, 'getAppUser').mockImplementation(
      async () => this.userModel(this.user(APP_USER.username)) as never
    );
    vi.spyOn(reddit, 'getUserByUsername').mockImplementation(async (username: string) => {
      const user = this.users.get(username.toLowerCase());
      return (user ? this.userModel(user) : undefined) as never;
    });
    vi.spyOn(reddit, 'getWikiPage').mockImplementation(async (_subreddit: string, page: string) => {
      const content = this.wiki.get(page);
      if (content === undefined) throw new Error(`Wiki page ${page} not found`);
      return { content } as never;
    });
    vi.spyOn(reddit, 'getUserFlairTemplates').mockImplementation(
      async () => this.flairTemplates as never
    );
    vi.spyOn(reddit, 'getModerators').mockImplementation(
      () =>
        ({
          all: async () => this.moderators.map((username) => ({ username })),
        }) as never
    );
    vi.spyOn(reddit, 'setUserFlair').mockImplementation(async (options) => {
      if (this.failFlairFor.has(options.username.toLowerCase())) {
        throw new Error('Flair service unavailable');
      }
      const user = this.user(options.username);
      if (options.text === undefined) delete user.flairText;
      else user.flairText = options.text;
      if (options.cssClass === undefined) delete user.flairCssClass;
      else user.flairCssClass = options.cssClass;
      this.flairUpdates.push({
        username: user.username,
        flairTemplateId: options.flairTemplateId,
        text: options.text,
        cssClass: options.cssClass,
      });
    });
    vi.spyOn(reddit, 'submitComment').mockImplementation(async (options) => {
      const failure = this.replyFailures.shift();
      if (failure) throw failure;
      this.replies.push({ parentId: options.id, text: 'text' in options ? options.text : '' });
      return { id: `t1_reply${this.nextId++}` } as never;
    });
    vi.spyOn(reddit, 'getPostById').mockImplementation(async (id: string) => {
      const post = this.posts.find((candidate) => candidate.id === id);
      if (!post) throw new Error(`Post ${id} not found`);
      return this.postModel(post) as never;
    });
    vi.spyOn(reddit, 'getPostsByUser').mockImplementation(
      (options) =>
        ({
          all: async () =>
            this.posts
              .filter((post) => post.authorName === options.username)
              .map((post) => this.postModel(post)),
        }) as never
    );
    vi.spyOn(reddit, 'getComments').mockImplementation((options) => {
      const failure = this.listingFailures.shift();
      const comments = this.comments.filter((comment) => comment.postId === options.postId);
      return {
        async *[Symbol.asyncIterator]() {
          if (failure) throw failure;
          yield* comments;
        },
      } as never;
    });
    vi.spyOn(reddit, 'submitPost').mockImplementation(async (options) => {
      const post = this.addPost({
        title: options.title,
        text: 'text' in options ? (options.text ?? '') : '',
        subredditName: options.subredditName ?? SUBREDDIT,
        ...('flairId' in options && options.flairId ? { flairId: options.flairId } : {}),
      });
      return this.postModel(post) as never;
    });
    vi.spyOn(reddit.modMail, 'createModNotification').mockImplementation(async (options) => {
      this.modNotifications.push({ subject: options.subject, bodyMarkdown: options.bodyMarkdown });
      return 'conversation-id';
    });
    vi.spyOn(reddit.modMail, 'getConversation').mockImplementation(
      async () =>
        ({
          conversation: { messages: Object.fromEntries(this.modmailMessages) },
        }) as never
    );
    vi.spyOn(reddit.modMail, 'reply').mockImplementation(async (options) => {
      this.modmailReplies.push({
        conversationId: options.conversationId,
        body: options.body,
        isInternal: options.isInternal ?? false,
      });
      return {} as never;
    });
  }
}

/** POSTs to one of the app's internal endpoints, the way Devvit delivers events. */
export async function deliver<T = unknown>(path: string, body: unknown = {}): Promise<T> {
  const response = await app.request(`/internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}
