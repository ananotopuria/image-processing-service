# Image sharing: frontend handoff

The backend shares an exact image record with a registered recipient by email.
All mutations use authenticated REST. Socket.IO delivers notification hints only;
MongoDB and REST remain authoritative for offline use and reconnect recovery.
No frontend files were added or modified.

**REST contract**

Send `Authorization: Bearer <accessToken>` on every endpoint below and
`Content-Type: application/json` on share creation. Successful responses have
`Cache-Control: private, no-store`. IDs are 24-character MongoDB ObjectId strings;
dates serialize as ISO 8601 strings. Swagger is available at `/api/docs`.

| Method | Exact path | Input | Success |
| --- | --- | --- | --- |
| POST | `/api/shares` | JSON `{ "imageId": "…", "recipientEmail": "recipient@example.com" }` | 201, share object |
| GET | `/api/shares/received?page=1&limit=10` | Pagination query | 200, page of shares received by the caller |
| GET | `/api/shares/sent?page=1&limit=10` | Pagination query | 200, page of enriched shares sent by the caller |
| GET | `/api/shares/:id` | Received **share ID**, not image ID | 200, `{ "share": {…}, "image": {…} }` with fresh signed URLs |
| DELETE | `/api/shares/:id` | Sent share ID; no body | 200, share object with `revokedAt` set and `available: false` |
| GET | `/api/notifications?page=1&limit=10` | Pagination query | 200, page of persisted notifications |
| GET | `/api/notifications/unread-count` | No body | 200, `{ "unreadCount": 1 }` |
| PUT | `/api/notifications/:id/read` | Notification ID; no body | 200, notification object with `readAt` set |

Create example:

```json
{
  "imageId": "66e83a109af861ce27c86a02",
  "recipientEmail": "recipient@example.com"
}
```

201 response (also the received-list item shape and revoke response):

```json
{
  "_id": "66e83a109af861ce27c86a03",
  "senderId": "66e83a109af861ce27c86a01",
  "recipientId": "66e83a109af861ce27c86a04",
  "imageId": "66e83a109af861ce27c86a02",
  "revokedAt": null,
  "createdAt": "2026-09-30T12:00:00.000Z",
  "updatedAt": "2026-09-30T12:00:00.000Z",
  "available": true
}
```

The request trims and lowercases the email, matching the User schema's email
normalization, then uses the existing UsersService email lookup. There is no
username fallback. Self-sharing is rejected after resolving recipient identity.
Neither user profiles nor password hashes are returned. No existing
username-based sharing implementation or share data migration was found.

Sent list, `GET /api/shares/sent?page=1&limit=10`, retains the same pagination
and base share fields above. Each item additionally includes these required fields:

```json
{
  "recipientEmail": "recipient@example.com",
  "image": { "filename": "photo.webp", "format": "webp" }
}
```

`recipientEmail` is the current email resolved from the stored `recipientId`, or
`null` if that user was deleted. `image` describes only the stored `imageId` and is
`null` if that exact image was deleted or no longer belongs to the sender. Its
`filename` uses the stored original basename and actual format (`jpeg` → `.jpg`,
`png` → `.png`, `webp` → `.webp`), exactly as the received-access endpoint does.
The extension is replaced case-insensitively in effect by replacing the last
suffix; multiple dots and names without extensions are supported.

Lookups are batched for the current page and authorized by the requesting sender.
Revoked shares retain these summaries when the related records exist, with
`available: false`. Existing ID-based shares need no migration or client-side
labels. No user profile, password, image storage key, sibling/original image
record or signed URL is added. A deleted recipient does not change the existing
`available` definition (revocation/image ownership); clients can show that account
as deleted independently. Create, revoke and received-list DTOs remain unchanged.
Swagger uses `PaginatedSentSharesDto`, `SentShareResponseDto`, and
`SentShareImageDto` for this endpoint. Deploy this backend contract before the
updated frontend; absent fields are a contract error, not deleted-record nulls.

Received detail example, `GET /api/shares/66e83a109af861ce27c86a03`:

```json
{
  "share": {
    "_id": "66e83a109af861ce27c86a03",
    "senderId": "66e83a109af861ce27c86a01",
    "recipientId": "66e83a109af861ce27c86a04",
    "imageId": "66e83a109af861ce27c86a02",
    "revokedAt": null,
    "createdAt": "2026-09-30T12:00:00.000Z",
    "updatedAt": "2026-09-30T12:00:00.000Z",
    "available": true
  },
  "image": {
    "_id": "66e83a109af861ce27c86a02",
    "filename": "photo.webp",
    "format": "webp",
    "kind": "transformed",
    "mimeType": "image/webp",
    "width": 800,
    "height": 600,
    "url": "https://example-bucket.s3.amazonaws.com/transformed/example.webp?X-Amz-Signature=example",
    "downloadUrl": "https://example-bucket.s3.amazonaws.com/transformed/example.webp?response-content-disposition=attachment&X-Amz-Signature=example",
    "urlExpiresAt": "2026-09-30T12:15:00.000Z"
  }
}
```

The example URLs are illustrative; actual URLs come from the existing S3 signer.
`kind` is `original` or `transformed`, and is absent for legacy images. Dimensions
are omitted when unavailable. `filename` is the suggested download name with an
extension matching the stored format (JPEG uses `.jpg`). The signed download URL
sets the attachment filename; use it for downloads. No raw storage keys, original
relationships, transformations, or sibling access URLs are exposed as metadata.

Only the recipient can fetch share detail. The owner continues to use existing
owner-only image endpoints. The recipient cannot transform, delete, favorite, or
reshare the owner's record. Sharing a processed version never grants access to
its original or siblings. Do not call `/api/images/:imageId` for received images;
refresh their URLs through `/api/shares/:shareId`.

Revocation returns the same share object with, for example,
`"revokedAt": "2026-09-30T12:05:00.000Z"`, `"updatedAt": "2026-09-30T12:05:00.000Z"`,
and `"available": false`. Repeated DELETE requests by the sender succeed and retain
the first revocation time. A later POST creates a **new** share and notification;
the old share remains revoked.

**Pagination and unavailable records**

All lists accept `page` (integer, 1–100000, default 1) and `limit` (integer, 1–50,
default 10). Unknown query/body fields are rejected. Ordering is newest first by
`createdAt`, then `_id`. Received/sent share lists include revoked/deleted-image
history. Notification lists include both read and unread history. There are no
additional filters. Example `GET /api/shares/received?page=1&limit=10`:

```json
{
  "items": [
    {
      "_id": "66e83a109af861ce27c86a03",
      "senderId": "66e83a109af861ce27c86a01",
      "recipientId": "66e83a109af861ce27c86a04",
      "imageId": "66e83a109af861ce27c86a02",
      "revokedAt": null,
      "createdAt": "2026-09-30T12:00:00.000Z",
      "updatedAt": "2026-09-30T12:00:00.000Z",
      "available": true
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 1,
  "totalPages": 1
}
```

An empty collection returns `items: []`, `total: 0`, `totalPages: 0`. A page beyond
the last page returns `items: []` and retains the actual totals. Pages/counts can
change between requests during concurrent writes.

`available` is computed from the share's revocation state and the continued
existence/ownership of its exact image record. Share/notification lists never
generate URLs. Deleted-image references remain as inaccessible history; no
cleanup job is required to enforce access. Original deletion already deletes its
processed records, so their shares also become unavailable. A version deletion
does not affect sibling shares. Notification references to missing shares are
handled as `available: false`, and can still be marked read. Availability may
change after listing: treat a detail 404 as authoritative and remove cached URLs.

**Notifications**

`GET /api/notifications` returns the same pagination envelope with these items:

```json
{
  "_id": "66e83a109af861ce27c86a05",
  "type": "image.shared",
  "shareId": "66e83a109af861ce27c86a03",
  "readAt": null,
  "createdAt": "2026-09-30T12:00:00.000Z",
  "updatedAt": "2026-09-30T12:00:00.000Z",
  "available": true
}
```

`PUT /api/notifications/66e83a109af861ce27c86a05/read` returns:

```json
{
  "_id": "66e83a109af861ce27c86a05",
  "type": "image.shared",
  "shareId": "66e83a109af861ce27c86a03",
  "readAt": "2026-09-30T12:02:00.000Z",
  "createdAt": "2026-09-30T12:00:00.000Z",
  "updatedAt": "2026-09-30T12:02:00.000Z",
  "available": true
}
```

Only the current recipient can read/update that notification. Marking read is
idempotent and preserves the first `readAt`. Opening a share does not implicitly
mark its notification read. Unread counts include notifications about unavailable
shares until explicitly marked read. There is no read/revoke socket event; fetch
REST state when the view becomes active or after these operations.

**Errors and retry behavior**

Validation error example:

```json
{
  "statusCode": 400,
  "message": ["recipientEmail must be an email"],
  "error": "Bad Request"
}
```

Conflict example:

```json
{
  "statusCode": 409,
  "message": "An active share already exists for this image and recipient",
  "error": "Conflict"
}
```

| Status | Causes/message |
| --- | --- |
| 400 | DTO validation (message array); self-share: `Cannot share an image with yourself` (message string) |
| 401 | `Authentication token is required`, `Invalid or expired authentication token`, or `Invalid authentication subject` |
| 404 | `Image not found`, `Recipient not found`, `Share not found`, `Shared image is unavailable`, or `Notification not found`; unauthorized resource access is also 404 |
| 409 | Existing active share, including concurrent/retried create requests |
| 429 | `ThrottlerException: Too Many Requests`; honor `Retry-After` |
| 500 | `Internal server error`; unexpected persistence failures do not expose details |
| 502 | `Unable to create image access URLs` |

Standard Nest error objects contain `statusCode`, `message`, and generally `error`
(`Unauthorized`, `Not Found`, `Bad Gateway`, etc.). The existing throttler's 429
and generic 500 responses omit `error`. Invalid IDs in create-body validation
return 400; invalid resource path IDs return 404.

Share creation is limited to **10 requests/minute per authenticated user**. Other
new endpoints use **60/minute per user per route**, following the image module's
throttling pattern. Changing tokens or IPs does not reset a user's route quota.

A partial unique MongoDB index on `(imageId, recipientId)` where `revokedAt: null`
allows only one active share. A separate unique `shareId` notification index
ensures one notification per share. Concurrent creates yield one 201 and the
others 409. If a create response is lost, retrieve sent shares to reconcile a
409; repeating the request never generates another active share or notification.
There is no client idempotency-key parameter. Resharing after revocation is an
intentional new operation. Internal transient transaction retries occur before
socket emission. Socket failure cannot turn a committed share into an HTTP error.

**Socket.IO contract**

Use Socket.IO v4 against the backend origin (same server/port as REST).

| Setting | Value |
| --- | --- |
| Namespace | `/notifications` |
| Engine.IO path | `/socket.io` (the `/api` REST prefix does not apply) |
| Authentication | Handshake `auth` object below; raw JWT without `Bearer ` |
| Transport | WebSocket or HTTP long-polling with upgrade |
| Origin | Existing exact `CORS_ORIGINS` allowlist for both transports |
| Client commands | None; sharing and marking read use REST |

Handshake auth:

```json
{ "token": "<accessToken>" }
```

Identity comes exclusively from verified JWT `sub`. Supplied `userId`/room values
are ignored. The server joins each verified connection to `user:<sub>`; clients
cannot choose rooms. All active sessions for that recipient receive the event.
Neither the sender nor other users receive it. Native clients may omit `Origin`
but still require a valid token. No images, signed URLs, or user details travel
through sockets.

Server event **`notification.created`**, emitted only after the transaction commits:

```json
{
  "notificationId": "66e83a109af861ce27c86a05",
  "type": "image.shared",
  "shareId": "66e83a109af861ce27c86a03",
  "createdAt": "2026-09-30T12:00:00.000Z"
}
```

Register listeners before connecting. On every successful `connect` (including
reconnect), fetch notifications, unread count, and received shares from REST.
Treat events as invalidation hints and deduplicate by notification ID. There is
no socket replay, acknowledgement-based delivery guarantee, or connection-state
recovery. A crash after commit but before emit can lose the hint; persisted
notification recovery still works. Fetch REST on view focus as well.

Missing, invalid, expired, malformed-subject, or non-expiring tokens trigger
Socket.IO `connect_error` with message `Invalid or expired authentication token`
and `error.data`:

```json
{ "code": "UNAUTHORIZED" }
```

An unapproved Origin is rejected at the transport handshake (transport-level
`connect_error`, not the structured authentication error above).

On token expiry the server emits **`auth.expired`** and disconnects the socket:

```json
{ "code": "TOKEN_EXPIRED" }
```

The disconnect reason is `io server disconnect`; automatic reconnect does not
resume that connection. Obtain a new token through existing sign-in, update the
client's `auth.token`, and explicitly connect again. Merely changing `auth.token`
on a connected socket does not extend its session; disconnect/reconnect when
replacing tokens. Network disconnects can use the client's normal automatic
reconnection, with the latest token supplied on each handshake. An expired token
will still fail authentication. There is no refresh-token endpoint. Treat the
expiry event as best effort: REST 401 or authentication `connect_error` also
requires sign-in.

**Deployment and storage**

Run `npm ci` after pulling the lockfile. Added runtime dependencies are
`@nestjs/websockets`, `@nestjs/platform-socket.io`, and `socket.io`. Test-only
dependencies are `socket.io-client` and `mongodb-memory-server`.

The configured database must support multi-document transactions: MongoDB Atlas,
a replica set, or a suitable sharded cluster. Standalone MongoDB is unsupported
for share creation; there is intentionally no non-atomic fallback. The example
`MONGODB_URI` already points at Atlas. For local development, configure a replica
set and include its replica-set name in the URI. Share and notification writes
use snapshot read concern and majority write concern.

Collections `shares` and `notifications` are added. Startup explicitly creates
their schema indexes and waits for completion before serving requests, including
when automatic indexes are disabled. The DB role must allow index creation;
startup fails if required indexes cannot be provisioned. Existing images/users
are unchanged. Availability checks enforce access without cascading share writes
from the existing image deletion flow.

No new environment variables are required. Existing `JWT_SECRET` verifies both
REST and socket tokens. **`JWT_EXPIRES_IN` now controls newly issued tokens**
(default `1h`). Existing non-expiring tokens retain the previous REST behavior but
are rejected by the socket gateway; sign in again for a finite token. Existing
`CORS_ORIGINS` configures socket origins as well as REST. Production proxies must
forward `/socket.io/` polling and WebSocket upgrade traffic and `/api/*` REST.

This implementation uses Socket.IO's in-process adapter and the existing
in-memory throttler: deploy one backend process for delivery to all active
sessions. Multiple processes require a shared Socket.IO adapter and shared
throttling storage; polling also needs session affinity. Those scaling additions
are outside this change. REST notifications remain durable across process restarts.

Keep S3 objects private, with public access blocked. The backend signs only the
selected stored object on authorized detail requests and never persists URLs.
**Issued signed URLs remain usable until expiry (up to 15 minutes), subject to
object existence, credentials, and bucket policy. Revoking a share prevents new
URLs; it does not invalidate already issued bearer links. Downloaded copies
cannot be revoked.** Image deletion can make existing links fail earlier. Do not
persist or log signed URLs in client analytics.

**Verification**

`npm run test:sharing` builds the backend, starts a temporary local MongoDB
replica set, and runs HTTP plus real Socket.IO tests. Its first run may download
a MongoDB binary into the OS temporary directory; CI must permit that download
and local listeners (or configure mongodb-memory-server's system binary).
The suite verifies offline persistence across application restart, real unique
index enforcement under concurrent requests, transaction rollback, authorization,
version isolation, revocation/resharing, deletion, pagination, notifications,
Swagger, throttling, socket authentication/origin/room isolation, and expiry.
S3 is substituted in this suite. It does not verify live S3, the configured remote
database, or a deployed two-account browser workflow.

Implementation references: [Mongoose transactions](https://mongoosejs.com/docs/api/connection.html#Connection.prototype.transaction())
and [Socket.IO middleware](https://socket.io/docs/v4/middlewares/).
