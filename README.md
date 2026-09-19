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

CORS permits GET, HEAD, POST, DELETE, and OPTIONS with `Authorization` and
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
List/get/delete each allow 60/minute per user. Sign-up/sign-in each allow 10/minute
per IP. Limits are in memory and return 429 with Retry-After when exceeded.

## Testing and project status

```bash
npm run lint
npm test -- --runInBand
npm run build
npm run test:http
npm run test:e2e -- --runInBand
git diff --check
```

HTTP tests bind localhost and use in-memory MongoDB/S3 substitutes; no cloud
credentials are needed. Unit tests also exercise real Sharp and offline URL signing.

- [Transformation order and individual Postman examples](docs/image-flow.md)
- [Final roadmap audit, endpoint flow, testing checklist and deployment debt](docs/backend-audit.md)

The core backend flow is implemented. Watermarking, caching and message queues are
not implemented. JWT expiry, production resource limits, storage consistency and
other deployment concerns are explicitly listed in the audit; this is not a claim
of production readiness. No frontend is included.
