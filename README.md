# SYSCCA TEAMCHAT PLATFORM

Central multi-application realtime chat platform built with Next.js, PostgreSQL, Prisma, and Socket.IO, with private/group messaging, RBAC, integrations, reporting, moderation, notifications, retention, and secure file attachments.

## Stack

- Next.js 16 + TypeScript
- PostgreSQL
- Prisma ORM 7
- Socket.IO realtime service
- Zod
- Pino
- Argon2
- Signed HttpOnly session cookie
- Attachment storage abstraction:
  - LOCAL filesystem
  - AWS S3
  - MinIO / S3-compatible storage
- Optional ClamAV malware scanning

## Requirements

- Node.js 22+
- PostgreSQL 17 recommended
- Docker optional but recommended for local PostgreSQL
- Writable attachment directory when using LOCAL storage
- Optional AWS S3 / MinIO / S3-compatible object storage
- Optional ClamAV / `clamd` when malware scanning is enabled
- PM2 recommended for production process management

## Setup

Copy the environment template:

```bash
cp .env.example .env
```

Install dependencies:

```bash
npm install
```

Start PostgreSQL with Docker when using the included local database service:

```bash
npm run db:up
```

Deploy the Prisma schema, generate the client, and seed base data:

```bash
npm run prisma:deploy
npm run prisma:generate
npm run prisma:seed
```

Typical fresh local setup:

```bash
cp .env.example .env
npm install
npm run db:up
npm run prisma:deploy
npm run prisma:generate
npm run prisma:seed
```

> Do not use `prisma migrate reset` against a production database.

## Environment Configuration

The project reads application configuration from `.env`. Replace all placeholder secrets before non-local use.

Important secrets include:

```env
SESSION_SECRET="replace-with-a-long-random-secret-minimum-32-characters"
CHAT_SESSION_SECRET="replace-with-a-separate-chat-session-secret-minimum-32-characters"
APPLICATION_CREDENTIAL_ENCRYPTION_KEY="replace-with-a-separate-credential-encryption-key-minimum-32-characters"
INTEGRATION_ENCRYPTION_KEY="replace-with-a-separate-random-secret-minimum-32-characters"
STORAGE_CREDENTIAL_ENCRYPTION_KEY="replace-with-a-separate-storage-encryption-key-minimum-32-characters"
```

### SESSION_SECRET

Protects the main application session.

Use a random secret of at least 32 characters.

### CHAT_SESSION_SECRET

Signs external widget chat sessions.

Use a dedicated secret separate from the main application session secret.

### APPLICATION_CREDENTIAL_ENCRYPTION_KEY

Encrypts host-application signing credentials stored in the TeamChat database.

### INTEGRATION_ENCRYPTION_KEY

Encrypts stored integration credentials.

External integration database credentials should use read-only accounts whenever possible.

### STORAGE_CREDENTIAL_ENCRYPTION_KEY

Encrypts static credentials stored for attachment storage providers, such as:

- AWS S3 Access Key / Secret Key
- MinIO Access Key / Secret Key
- S3-compatible storage credentials

This key is not required for ordinary LOCAL attachment storage.

If no dedicated storage key is configured, the current implementation can fall back to another application encryption secret. Production environments should nevertheless configure a dedicated `STORAGE_CREDENTIAL_ENCRYPTION_KEY`.

Do not change this key after static S3/MinIO credentials have been stored unless the credentials are re-encrypted or recreated. Losing this key can make stored external-storage credentials unreadable.

Generate secrets with a cryptographically secure random generator. For example:

```bash
openssl rand -base64 48
```

PowerShell example:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

## Local Development

Run Next.js and the realtime process separately.

### Next.js application

```bash
npm run dev
```

### Realtime service

Run in another terminal:

```bash
npm run dev:realtime
```

Default local endpoints:

- Next.js: `http://localhost:3000`
- Realtime Socket.IO: `http://localhost:3001`

Both processes should be running when testing realtime chat behavior.

## Production Build

Install dependencies and validate the application:

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
npm run typecheck
npm test
npm run test:quality
npm run build
```

For deployments where `package-lock.json` is intentionally being updated, use `npm install` instead of `npm ci`.

The attachment release verifier is optional during normal deployment. Run it after attachment-related changes, after source merges/updates that may affect attachment integration, or as an additional pre-release check.

## PM2 Production Deployment

The repository includes `ecosystem.config.cjs` with two processes:

- `syscca-teamchat-app` — Next.js production application
- `syscca-teamchat-ws` — Socket.IO realtime service

### First start

From the project directory:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

View logs:

```bash
pm2 logs
```

View logs for one process:

```bash
pm2 logs syscca-teamchat-app
pm2 logs syscca-teamchat-ws
```

### Restart after deployment

After a new build or environment change:

```bash
pm2 restart syscca-teamchat-app --update-env
pm2 restart syscca-teamchat-ws --update-env
pm2 status
```

Or restart the ecosystem configuration:

```bash
pm2 restart ecosystem.config.cjs --update-env
```

### Recommended deployment sequence

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
npm run typecheck
npm test
npm run test:quality
npm run build
pm2 restart ecosystem.config.cjs --update-env
pm2 status
```

If PM2 has not been configured yet:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

Configure PM2 startup according to the operating system so the processes return after a server reboot.

## Validation

After dependencies and the Prisma client are available:

```bash
npm run typecheck
npm run test:quality
npm test
```

Run the complete regression suite if the project version provides `test:all`:

```bash
npm run test:all
```

Build the production application:

```bash
npm run build
```

### Optional Attachment Verification

The attachment verifier is not required to run the application and does not need to be executed on every start or restart.

Run it after changing attachment-related source, after merges or upgrades that may affect attachment integration, or before an important production release:

```bash
npm run attachments:release:verify
```

Expected successful result:

```text
Attachment release verification PASS
```

The verifier checks attachment backend files, public widget scripts, widget loader integration, private/group attachment IDs, realtime attachment handling, RBAC menu integration, and release requirements.

## Seed Data

`npm run prisma:seed` creates or updates the project foundation, including:

- Protected ROOT account
- Base permission catalog
- Built-in `chat_logs` report definition
- Default global retention policies
- Presence cleanup configuration
- Attachment foundation configuration
- Attachment file-type policies

Roles are intentionally application-specific and are not globally seeded.

## Main Features

- Multi-application / tenant-aware chat platform
- Application credentials and bootstrap-token authentication
- Private chat
- Group chat
- Socket.IO realtime messaging
- Presence
- Notifications and mute settings
- RBAC roles and permissions
- Internal users and external user integrations
- Database/API integrations
- Forbidden-word moderation
- Logs and audit
- Chat Logs reporting and export
- Data retention
- File attachments
- Attachment audit events
- Attachment visibility in admin Chat Logs

# Attachment Feature

TeamChat supports secure attachments in private and group conversations.

Supported behavior includes:

- Text + attachment messages
- Attachment-only messages
- Multiple attachments per message
- Drag-and-drop upload
- Upload progress
- Cancel and retry
- Image preview
- PDF preview
- Download
- Delete own attachment
- Authorized delete of another user's attachment
- File extension validation
- MIME validation
- File signature validation
- Temporary upload handling
- Orphan cleanup
- Retention cleanup
- Quota enforcement
- Upload rate limiting
- Optional malware scanning
- LOCAL storage
- AWS S3
- MinIO / S3-compatible storage
- Signed external-storage access
- Storage-provider migration

## Attachment Administration

Open:

```text
Dashboard → Attachments
```

Local URL:

```text
http://localhost:3000/dashboard/attachments
```

Attachment administration includes configuration for:

- Global and per-application attachment enablement
- Private/group attachment policies
- Allowed file types
- Maximum file size
- Maximum files per message
- Maximum total size per message
- Application storage quota
- Image/PDF preview
- MIME validation
- File-signature validation
- Temporary upload TTL
- Failed-cleanup policy
- Upload rate limits
- Delete retry behavior
- Download/preview audit settings
- Malware scanning
- Storage providers

## Attachment Storage

### LOCAL

Default local storage path:

```text
storage/attachments
```

The Next.js process must have read/write permission to this directory.

Do not move attachment data under `public/`. Attachment data is protected by authenticated API routes and application/room access checks.

### AWS S3 / MinIO

Manage external providers from:

```text
Dashboard → Attachments → Storage Providers
```

Supported capabilities include:

- AWS S3
- MinIO
- S3-compatible endpoints
- Static credentials
- Signed URLs
- Connection tests
- Provider health status
- Migration between storage providers

When TeamChat stores static provider credentials, configure a dedicated:

```env
STORAGE_CREDENTIAL_ENCRYPTION_KEY="secure-random-secret"
```

## Attachment Storage Migration

Perform a dry-run first:

```bash
npm run attachments:storage:migrate -- \
  --source=<SOURCE_PROVIDER_ID> \
  --target=<TARGET_PROVIDER_ID> \
  --application=<APPLICATION_ID> \
  --dry-run
```

After verification, repeat the command without `--dry-run`.

Do not delete source objects during the first production migration until the target provider has been validated.

## Attachment Maintenance

Run manually:

```bash
npm run attachments:maintenance
```

The worker handles tasks such as:

- Expired attachment retention
- Message-delete cleanup
- Temporary/orphan uploads
- Failed/rejected cleanup
- Physical-delete retry
- Stale processing states
- Old upload-rate buckets

Run the maintenance worker periodically in production.

Example Linux cron every 15 minutes:

```cron
*/15 * * * * cd /var/www/TeamChat-Platform && npm run attachments:maintenance >> /var/log/teamchat-attachment-maintenance.log 2>&1
```

Adjust the project path and service account to the deployment environment.

## Attachment Permissions

### Private Chat

```text
chat.private.attachment.send
chat.private.attachment.download
chat.private.attachment.preview
chat.private.attachment.delete
chat.private.attachment.delete_others
```

### Group Chat

```text
chat.group.attachment.send
chat.group.attachment.download
chat.group.attachment.preview
chat.group.attachment.delete
chat.group.attachment.delete_others
```

`delete` allows users to delete their own attachment.

`delete_others` allows an authorized moderator/admin to delete another user's attachment.

## Attachment Logs & Audit

Attachment activity is written to the standard TeamChat audit/system logging infrastructure.

Examples include:

```text
ATTACHMENT_UPLOAD
ATTACHMENT_DOWNLOAD
ATTACHMENT_PREVIEW
ATTACHMENT_DELETED
ATTACHMENT_DELETED_BY_MODERATOR
ATTACHMENT_MALWARE_DETECTED
ATTACHMENT_MALWARE_SCAN_FAILED
ATTACHMENT_UPLOAD_RATE_LIMITED
ATTACHMENT_QUOTA_EXCEEDED
ATTACHMENT_STORAGE_DELETE_FAILED
ATTACHMENT_STORAGE_MIGRATED
ATTACHMENT_STORAGE_MIGRATION_FAILED
```

Open:

```text
Dashboard → Logs & Audit
```

Local URL:

```text
http://localhost:3000/dashboard/logs
```

## Attachments in Admin Chat Logs

The Chat Logs report can display attachment information alongside the original message.

Open:

```text
Dashboard → Reports → Chat Logs
```

Local URL:

```text
http://localhost:3000/dashboard/reports/chat-logs
```

The report supports:

- Text + attachment messages
- Attachment-only messages
- Original filename
- File extension
- File size
- Attachment status
- Malware scan status
- Admin preview
- Admin download
- Attachment data in report export

Attachment preview/download follows the effective Chat Logs report scope. Admin attachment access must not bypass application or report authorization.

Administrative Chat Logs attachment access is audited.

## Optional Malware Scanning

ClamAV support is optional and should remain disabled until `clamd` is installed and tested.

Typical default scanner endpoint:

```text
Host: 127.0.0.1
Port: 3310
```

Do not expose `clamd` directly to the public internet.

Scanner errors should fail closed rather than incorrectly marking files as safe.

# Widget

Open the demo page:

```text
http://localhost:3000/widget-demo.html
```

Enter:

- Application Key
- Valid short-lived signed bootstrap token

Then use:

```text
Generate Token & Mount Widget
```

The widget includes authentication, realtime, private chat, group chat, notifications, and attachment integration.

The attachment integration supports widget destroy and remount lifecycle.

After deploying public widget JavaScript changes, perform a hard browser refresh when testing:

```text
Ctrl + Shift + R
```

## Local URLs

- App: `http://localhost:3000`
- Login: `http://localhost:3000/login`
- Dashboard: `http://localhost:3000/dashboard`
- Applications: `http://localhost:3000/dashboard/applications`
- Integrations: `http://localhost:3000/dashboard/integrations`
- Roles: `http://localhost:3000/dashboard/roles`
- Users & Access: `http://localhost:3000/dashboard/users`
- Attachments: `http://localhost:3000/dashboard/attachments`
- Logs & Audit: `http://localhost:3000/dashboard/logs`
- Chat Logs: `http://localhost:3000/dashboard/reports/chat-logs`
- Widget Demo: `http://localhost:3000/widget-demo.html`
- Health: `http://localhost:3000/api/health`

## Security Notes

- Replace all example secrets before non-local use.
- Never commit `.env` or production secrets to source control.
- Use separate encryption/session secrets for different responsibilities.
- Integration credentials are encrypted before storage; configure `INTEGRATION_ENCRYPTION_KEY`.
- Host application signing credentials are encrypted before storage; configure `APPLICATION_CREDENTIAL_ENCRYPTION_KEY`.
- Static attachment storage credentials are encrypted before storage; configure `STORAGE_CREDENTIAL_ENCRYPTION_KEY` when using stored S3/MinIO credentials.
- Use a separate `CHAT_SESSION_SECRET` for widget chat sessions in production.
- Bootstrap tokens must be generated server-side by the host application and kept short-lived.
- External database credentials should be read-only whenever possible.
- Every tenant/application query must enforce `applicationId` scope.
- ROOT is protected and bypasses normal business-role authorization.
- Frontend menu visibility is never considered backend authorization.
- Role and permission changes are resolved from the database on protected server requests.
- Attachment access must enforce application, room, identity, permission, and report scope.
- LOCAL attachment data must remain outside the public web directory.
- Admin attachment access through Chat Logs must respect effective report scope.
- Encryption keys must be backed up securely.
- Do not rotate an encryption key without a credential re-encryption/recreation plan.

## Recommended Production Verification Checklist

Before go-live or after a substantial deployment:

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
npm run typecheck
npm test
npm run test:quality
npm run build
```

Optionally run the attachment release verifier when attachment code has changed or for an additional pre-release regression check:

```bash
npm run attachments:release:verify
```

Then verify:

- Next.js application is running
- Realtime service is running
- PostgreSQL connectivity is healthy
- PM2 processes are online when PM2 is used
- LOCAL attachment directory is writable when LOCAL storage is enabled
- S3/MinIO connection test succeeds when external storage is used
- Attachment permissions are assigned to the intended roles
- Private attachment upload works
- Group attachment upload works
- Attachment-only messages work
- Multiple-file upload works
- Preview works
- Download works
- Delete works according to permission
- Widget destroy/remount keeps attachment controls available
- Chat Logs display attachments correctly
- Chat Logs attachment preview/download works for authorized admins
- Attachment maintenance is scheduled
- Attachment audit events are recorded
- Retention cleanup works
- Cross-room attachment access is rejected
- Cross-application attachment access is rejected
