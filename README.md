# SYSCCA TEAMCHAT PLATFORM

## Stack

- Next.js 16 + TypeScript
- PostgreSQL
- Prisma ORM 7
- Socket.IO prepared for realtime phases
- Zod
- Pino
- Argon2
- Signed HttpOnly session cookie

## Requirements

- Node.js 22+
- PostgreSQL 17 recommended
- Docker optional but recommended for local PostgreSQL

## Setup

```bash
cp .env.example .env
npm install
npm run db:up
npm run prisma:deploy
npm run prisma:generate
npm run prisma:seed
```

For local development, run Next.js and the realtime process separately:

Run the Next.js application:

```bash
npm run dev
```

Run realtime in another terminal:

```bash
npm run dev:realtime
```

## Validation

After `npm install` / `npm ci` has generated the Prisma client:

```bash
npm run test:quality
npm test
```

Run the complete quality + regression suite:

```bash
npm run test:all
```

## Seed data

`npm run prisma:seed` creates or updates:

- Protected ROOT account.
- Base permission catalog.
- Built-in `chat_logs` report definition.
- Default global retention policies.
- Presence cleanup setting of 8 hours.

Roles are intentionally application-specific and are not globally seeded.

## Local URLs

- App: http://localhost:3000
- Login: http://localhost:3000/login
- Dashboard: http://localhost:3000/dashboard
- Applications: http://localhost:3000/dashboard/applications
- Integrations: http://localhost:3000/dashboard/integrations
- Roles: http://localhost:3000/dashboard/roles
- Users & Access: http://localhost:3000/dashboard/users
- Health: http://localhost:3000/api/health

Then open `http://localhost:3000/widget-demo.html`, enter the application key and a valid short-lived signed bootstrap token, and mount the widget.

## Security notes

- Replace all example secrets before non-local use.
- Integration credentials are encrypted before storage; use a dedicated `INTEGRATION_ENCRYPTION_KEY` in non-local environments.
- Host application signing secrets are encrypted before storage; use a dedicated `APPLICATION_CREDENTIAL_ENCRYPTION_KEY`.
- Use a separate `CHAT_SESSION_SECRET` for widget chat sessions in production.
- Bootstrap tokens must be generated server-side by the host application and kept short-lived.
- External database credentials should be read-only whenever possible.
- Every tenant/application query must enforce `applicationId` scope.
- ROOT is protected and bypasses normal business-role authorization.
- Frontend menu visibility is never treated as backend authorization.
- Role and permission changes are resolved from the database on protected server requests.
