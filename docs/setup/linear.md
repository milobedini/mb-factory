# Linear setup

## Team and workflow

The team (`TAS` for Tastebook) needs these statuses, in this order. Edit them in **Settings → Teams → <team> → Workflow**.

| Status | Category | Notes |
| --- | --- | --- |
| Backlog | Backlog | Exists by default |
| Todo | Unstarted | Exists by default |
| Researching | Started | New |
| Spec | Started | New |
| Spec Review | Started | New. Human gate |
| Building | Started | Rename **In Progress** to this |
| In Review | Started | Exists by default |
| Awaiting Merge | Started | New. Human gate |
| Done | Completed | Exists by default |
| Canceled | Canceled | Exists by default |

The names must match `linear.statuses` in `projects/<name>/factory.yaml`.

Also turn on **Settings → Teams → <team> → Triage**, so issues created by the factory land in the Triage inbox first.

## Agent app

The factory installs as an app user, so it can be delegated issues and mentioned.

1. **Settings → API → OAuth applications → Create new.**
   - **Name:** Tastebook (this is the handle: `@Tastebook`)
   - **Icon:** any square image
   - **Developer name / URL:** mb-factory, `https://github.com/milobedini/mb-factory`
   - **Callback URLs:** `https://mb-factory-console.vercel.app/api/linear/oauth/callback`
   - **Public:** off
   - **Webhooks:** on
     - **URL:** `https://mb-factory-console.vercel.app/api/webhooks/linear`
     - **Events:** Agent session events, Inbox notifications, Permission changes, Issues, Comments
2. Save. Copy the **Client ID**, **Client secret** and **Webhook signing secret**.
3. In your own terminal, from the repo root:

   ```bash
   vercel env add LINEAR_CLIENT_ID production
   vercel env add LINEAR_CLIENT_SECRET production
   vercel env add LINEAR_WEBHOOK_SECRET production
   ```

4. Once the console is redeployed, open `https://mb-factory-console.vercel.app/api/linear/oauth/start` and approve. This installs the app with `actor=app` and the `read`, `write`, `app:assignable` and `app:mentionable` scopes, and stores the token in the factory database.
