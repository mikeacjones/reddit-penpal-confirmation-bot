import { context, reddit } from '@devvit/web/server';

/** Sends an archivable notification to the subreddit's modmail. Never throws. */
export async function notifyMods(subject: string, bodyMarkdown: string): Promise<void> {
  try {
    await reddit.modMail.createModNotification({
      subject: `Confirmation bot: ${subject}`,
      bodyMarkdown,
      subredditId: context.subredditId,
    });
  } catch (error) {
    console.error(`Failed to send modmail "${subject}"`, error);
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
