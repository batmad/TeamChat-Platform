# Realtime Layer

The realtime layer runs as a dedicated Socket.IO process from the same repository.

Commands:

```bash
npm run dev:realtime
npm run start:realtime
```

Core responsibilities in Roadmap Phase 8:

- Chat-session socket authentication.
- Application origin validation.
- Online/offline presence.
- Multi-connection counting.
- Heartbeat and last seen.
- Reconnect recovery.
- Presence cleanup.

Reserved base rooms:

```text
application:{applicationId}
user:{userIdentityId}
```

Group/private room logic and message events belong to later roadmap phases.

Keep this domain isolated so it can move to its own deployment later. Multi-node deployment will require a shared Socket.IO adapter and shared presence strategy.

## Private Chat Events

Client -> server:

- `private:open`
- `private:join`
- `private:leave`
- `private:message:send`
- `private:messages:read`
- `private:typing:start`
- `private:typing:stop`

Server -> client:

- `private:joined`
- `private:left`
- `private:message:new`
- `private:messages:read`
- `private:typing`

Private-room history remains available to participants after shared-group changes, but every new send revalidates current shared groups unless the sender has `chat.private.all`.

## Notification Events

Roadmap Phase 12 adds persistent notification delivery on top of group/private chat.

Server -> client:

- `notification:new`
- `notification:badge`

`notification:new` is sent through `user:{userIdentityId}` rooms only after recipient access has been resolved. It includes total unread, room unread, and server-evaluated sound/browser alert flags.

`notification:badge` synchronizes floating-bubble badge state on initial socket connection and after chat read operations.

See `docs/roadmap-phase-12-notification-system.md`.
