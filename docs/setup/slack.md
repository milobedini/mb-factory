# Slack app setup

One Slack app per factory. Its name is the handle people mention (`@Tastebook`).

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest** → pick the workspace.
2. Paste `projects/<name>/slack-manifest.yaml` (switch the editor to YAML) → **Next** → **Create**.
   Slack tries to verify the event URL straight away. It fails until step 4 is done; that's expected.
3. **Basic Information → App Credentials:** copy the **Signing Secret**.
4. In your own terminal (not through Claude, so the secret stays out of the transcript), from the repo root:

   ```bash
   vercel env add SLACK_SIGNING_SECRET production
   ```

   Then redeploy (`vercel deploy --prod`), or ask Claude to.
5. **Event Subscriptions:** click **Retry** next to the request URL. It should show **Verified**. Save.
6. **Install App → Install to Workspace.** Copy the **Bot User OAuth Token** (`xoxb-…`) and add it the same way:

   ```bash
   vercel env add SLACK_BOT_TOKEN production
   ```

7. Create the factory channel (`#tastebook-factory`) and `/invite @Tastebook`.

## Why these scopes

| Scope | Used for |
| --- | --- |
| `app_mentions:read`, `channels:history`, `groups:history`, `im:history` | Reading the request and the thread it sits in |
| `channels:read`, `groups:read`, `im:read` | Resolving channel and DM IDs |
| `chat:write`, `im:write` | Replying in threads and DMs |
| `files:read` | Attachments on a request |
| `reactions:read`, `reactions:write` | 👀 acknowledgement; reaction-triggered intake later |
| `users:read`, `users:read.email` | Mapping Slack users to Linear users by email |
