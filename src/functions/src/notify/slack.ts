import * as functions from 'firebase-functions/v1';

// Uses global fetch (Node 18/20)
export async function sendSlack(text: string, extra?: Record<string, any>) {
  try {
    const cfg: any = functions.config() as any;
    const url = cfg?.alert?.slack_webhook || cfg?.notify?.slack_url || '';
    if (!url) return; // no-op if not configured
    const payload: any = extra
      ? {
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: '```' + JSON.stringify(extra, null, 2) + '```' }] },
          ],
        }
      : { text };

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // ignore failures to avoid breaking prod path
  }
}

