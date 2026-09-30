# Image Processing Service

NestJS backend for authenticated image uploads, transformations, and private S3
retrieval. Originals are preserved; each transformation creates a separate version
with metadata in MongoDB.

## 🚀 Live API

Backend API: [https://image-processing-service-s34x.onrender.com](https://image-processing-service-s34x.onrender.com)

## 📚 API Documentation

Swagger UI: [https://image-processing-service-s34x.onrender.com/api/docs](https://image-processing-service-s34x.onrender.com/api/docs)

## Run locally

Use the Node version in `.nvmrc`.

```bash
npm ci
cp .env.example .env
npm run start:dev
```

Before starting, set the local `.env` values for MongoDB, JWT signing, AWS region,
private S3 bucket, and AWS credentials. Never commit `.env`. The AWS principal
needs GetObject, PutObject, and DeleteObject access to the stored image prefixes.
Default port is 3000; `PORT` can override it.

Open [Swagger UI](http://localhost:3000/api/docs). Sign up or sign in, then paste
the returned `accessToken` into Swagger's Authorize dialog.

## Frontend CORS and Render

Set this in local `.env` and in the Render backend service's environment:

```dotenv
CORS_ORIGINS=http://localhost:5173
```

`CORS_ORIGINS` is required and accepts comma-separated exact HTTP(S) browser
origins. Whitespace is trimmed and empty entries are ignored. When your deployed
frontend URL is known, append its origin after a comma. Use the browser's
`URL.origin` form (scheme, hostname, and non-default port only), without paths,
trailing slashes, credentials, queries, fragments, or wildcards. Missing, empty,
or invalid configuration causes startup to fail with a `CORS_ORIGINS` error.
Keep `.env` untracked; it is already ignored.

In the Render Dashboard, select the backend service, open **Environment**, and
add `CORS_ORIGINS` with value `http://localhost:5173`. Save the variable and deploy
the commit containing this change. **Save, rebuild, and deploy** rebuilds the
service; **Save only** leaves the variable inactive until the next deployment.
See [Render's environment variable instructions](https://render.com/docs/configure-environment-variables).
A backend redeployment is required; local tests do not verify the deployed service.

CORS permits GET, HEAD, POST, PUT, DELETE, and OPTIONS with `Authorization` and
`Content-Type`, and exposes `Retry-After`. Preflights are handled before JWT
guards; actual protected requests still require a Bearer token. Cookie credentials
are disabled. Requests without `Origin` continue normally. Unlisted browser
origins receive no `Access-Control-Allow-Origin` permission; CORS does not replace
authentication or prevent non-browser clients from calling the API.

## API

All image routes require Bearer authentication; paths include `/api`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/sign-up` | Register and receive a JWT. |
| POST | `/api/auth/sign-in` | Sign in and receive a JWT. |
| GET | `/api/auth/profile` | View verified token claims. |
| POST | `/api/images/upload` | Upload multipart `file`, JPEG/PNG/WebP, less than 5 MiB. |
| GET | `/api/images?page=1&limit=10` | List owned images with pagination (maximum limit 50). |
| GET | `/api/images/favorites?page=1&limit=10` | List my accessible favorite images. |
| PUT | `/api/images/:id/favorite` | Add an owned image to my favorites (idempotent). |
| DELETE | `/api/images/:id/favorite` | Remove an owned image from my favorites (idempotent). |
| POST | `/api/images/:id/transform` | Apply nested operations to an owned original. |
| GET | `/api/images/:id` | Get metadata and temporary display/download URLs. |
| DELETE | `/api/images/:id` | Delete a version, or an original and its versions. |

Image responses include `url`, `downloadUrl`, and `urlExpiresAt`; links last up to
15 minutes without making S3 public. Refresh links by retrieving the record again.
A holder of a signed URL can use it until expiry, so treat it as a bearer link.

Transform supports resize, crop, rotation, vertical flip, horizontal mirror,
quality, JPEG/PNG/WebP conversion, grayscale and sepia:

```json
{
  "transformations": {
    "resize": { "width": 800 },
    "rotate": 90,
    "filters": { "sepia": true },
    "format": "webp",
    "quality": 80
  }
}
```

Upload and transform each allow 10 requests/minute per authenticated user.
List/get/delete and each favorites endpoint allow 60/minute per user. Sign-up/sign-in each allow 10/minute
per IP. Limits are in memory and return 429 with Retry-After when exceeded.

## Favorites frontend contract

Send `Authorization: Bearer <accessToken>` on all three routes. Identity always
comes from the verified JWT `sub`; a supplied body `userId` never changes it.
Only owned images can currently be favorited. Originals, transformed versions,
and legacy images each have independent favorite membership.

- `PUT /api/images/:id/favorite`: no body or query parameters required.
  Returns **200** `{ "imageId": "66e83a109af861ce27c86a02", "isFavorite": true }`.
  Repeated additions succeed without creating duplicates.
- `DELETE /api/images/:id/favorite`: no body or query parameters required.
  Returns **200** `{ "imageId": "66e83a109af861ce27c86a02", "isFavorite": false }`.
  Repeated removals succeed while the image exists and is owned by the caller.
- `GET /api/images/favorites`: optional integer query parameters `page` (default
  **1**, range **1–100000**) and `limit` (default **10**, range **1–50**).
  Unknown query parameters and invalid/repeated values return **400**.

The favorites list returns **200** with the same envelope as `GET /api/images`:

```json
{
  "items": [
    {
      "_id": "66e83a109af861ce27c86a02",
      "user": "66e83a109af861ce27c86a01",
      "originalName": "mountains.png",
      "filename": "9c1c0381-01af-4210-970c-68292d28c577.png",
      "format": "png",
      "kind": "original",
      "mimeType": "image/png",
      "originalSize": 2457600,
      "createdAt": "2026-09-17T12:00:00.000Z",
      "updatedAt": "2026-09-17T12:00:00.000Z",
      "isFavorite": true,
      "url": "https://example-bucket.s3.amazonaws.com/example.png?X-Amz-Signature=example",
      "downloadUrl": "https://example-bucket.s3.amazonaws.com/example.png?response-content-disposition=attachment&X-Amz-Signature=example",
      "urlExpiresAt": "2026-09-18T12:15:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 1,
  "totalPages": 1
}
```

Items sort by **image creation time descending**, then image ID descending;
favoriting an image again does not move it. `total` counts only this user's
favorites whose image still exists and is accessible. `totalPages` is
`ceil(total / limit)`, or **0** for no matches. Pages past the end have empty
`items` while retaining the matching `total` and `totalPages`.

Each item uses `ImageResponseDto`. Required fields are `_id`, `user`,
`originalName`, `filename`, `format`, `originalSize`, `createdAt`, `updatedAt`,
`isFavorite`, `url`, `downloadUrl`, and `urlExpiresAt`. Depending on record type,
optional fields are `kind`, `mimeType`, `originalImageId`, `transformations`,
`width`, `height`, `quality`, and `processedSize`. IDs and timestamps serialize
as strings; sizes and dimensions are numbers. Favorites list items always have
`isFavorite: true`. Normal image list/detail responses include the caller's
membership; newly uploaded images and new transformed versions return `false`.

**Response compatibility change:** raw storage keys `path` and `originalKey`
are no longer returned on image responses. Use `url`/`downloadUrl` for file
access and `originalImageId` for version history. Persistence internals and
favorite documents are excluded from the public image metadata. Signed links
retain the existing 15-minute lifetime and must be treated as bearer links.
Successful favorites responses use `Cache-Control: private, no-store`.

Error contract (standard NestJS JSON):

| Status | When | Response |
| --- | --- | --- |
| 400 | Invalid favorites pagination or unknown query parameter | `{ "statusCode": 400, "message": ["validation message"], "error": "Bad Request" }` |
| 401 | Missing Bearer token | `{ "statusCode": 401, "message": "Authentication token is required", "error": "Unauthorized" }` |
| 401 | Invalid/expired token | `{ "statusCode": 401, "message": "Invalid or expired authentication token", "error": "Unauthorized" }` |
| 404 | Mutation ID is invalid, missing, deleted, or belongs to someone else | `{ "statusCode": 404, "message": "Image not found", "error": "Not Found" }` |
| 429 | More than 60 requests/minute per user per endpoint | `{ "statusCode": 429, "message": "ThrottlerException: Too Many Requests" }`; honor `Retry-After` |
| 500 | Database/unexpected failure | `{ "statusCode": 500, "message": "Internal server error" }` |
| 502 | Favorites list cannot generate access URLs | `{ "statusCode": 502, "message": "Unable to create image access URLs", "error": "Bad Gateway" }` |

Favorites are stored in the separate `favorites` collection with ObjectId
`userId` and `imageId`, `createdAt`/`updatedAt`, a unique `(userId, imageId)`
index, and an `imageId` cleanup index. Standard Mongoose startup index creation
creates these indexes; deployments that disable automatic indexes must provision
them before serving favorite writes. No image-level favorite flag is persisted.
Deleting an image removes all its favorite references, including references on
versions when an original is deleted. MongoDB writes and S3 deletion retain the
existing nontransactional behavior: an interrupted/failed cleanup can leave stale
references, which the list excludes from both items and totals.

## Testing and project status

```bash
npm run lint
npm test -- --runInBand
npm run build
npm run test:http
npm run test:sharing
npm run test:e2e -- --runInBand
git diff --check
```

HTTP tests bind localhost and use in-memory MongoDB/S3 substitutes; no cloud
credentials are needed. Unit tests also exercise real Sharp and offline URL signing.

- [Transformation order and individual Postman examples](docs/image-flow.md)
- [Email sharing and persistent notifications: frontend handoff](docs/image-sharing-handoff.md)
- [Final roadmap audit, endpoint flow, testing checklist and deployment debt](docs/backend-audit.md)

The core backend flow is implemented. Watermarking, caching and message queues are
not implemented. JWT expiry now uses `JWT_EXPIRES_IN` (default `1h`). Sharing
requires a MongoDB replica set/Atlas for transactions; Socket.IO uses the existing
`CORS_ORIGINS` allowlist. Production resource limits, storage consistency and
other deployment concerns are explicitly listed in the audit; this is not a claim
of production readiness. No frontend is included.
