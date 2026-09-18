# Final backend audit — Day 3

This audit compares the implemented backend with the
[roadmap.sh Image Processing Service project](https://roadmap.sh/projects/image-processing-service).
The existing routes are preserved under `/api`; roadmap route names are examples,
not an additional set of aliases.

## Completion checklist

| Area | Classification | Implementation / limit |
| --- | --- | --- |
| Sign-Up | Implemented | Email/username/password DTO, bcrypt hash, public user details and JWT; duplicate email normally 409. |
| Log-In | Implemented | Email/password verification, JWT, invalid credentials 401. |
| JWT authentication | Implemented | Existing bearer guard protects all image routes; missing/invalid/expired JWT 401. Issued tokens currently have no configured expiry; see deployment debt. |
| Upload image | Implemented | Multipart `file`, detected JPEG/PNG/WebP type, strictly less than 5 MiB, original bytes preserved. |
| Transform image | Implemented | One or multiple nested operations; owned original is always the source; independent version records. |
| Retrieve image | Implemented | Owned metadata plus private-S3 display/download URLs, up to 15 minutes. Retrieve converted versions by their IDs. |
| List images | Implemented | Owner-scoped page/limit, total/totalPages, stable newest-first ordering, signed URLs per item. |
| Resize | Implemented | Width and/or height, centered cover when both supplied. |
| Crop | Implemented | Original-pixel x/y and dimensions, bounds checked. |
| Rotate | Implemented | Finite angles from -360 to 360, including fractions. |
| Watermark | Optional/not implemented | Deferred asset-based design below; the complete suggested transformation catalogue is not implemented. |
| Flip | Implemented | Vertical flip before rotation. |
| Mirror | Implemented | Horizontal flop before rotation. |
| Compress | Implemented | Encoding quality 1–100; PNG palette quality; output is not guaranteed smaller. |
| Change format | Implemented | JPEG, PNG, WebP. |
| Filters | Implemented | Grayscale and sepia, including combined use. |
| Cloud storage | Implemented | AWS SDK v3 S3 put/get/delete/presign; no public bucket or local-disk upload path. |
| Rate limiting | Implemented | Nest throttler with per-user image quotas and per-IP auth quotas; process-local only. |
| Error handling | Implemented | 400/401/404/409/413/422/429/500/502; safe server responses; best-effort cross-service cleanup. |
| Validation | Implemented | Existing strict ValidationPipe, nested DTOs, file content/size checks, pagination bounds. |
| Swagger | Implemented | Request/response schemas, nested examples, bearer security, pagination, access URLs, rate/error descriptions. |
| Production hardening | Partially implemented | Known operational/security debt below remains before public deployment. |
| Caching | Optional/not implemented | Versions are independent outputs; no transformation-result cache. |
| RabbitMQ/Kafka/Redis | Optional/not implemented | Not needed for the scoped demo; no services added merely to claim completion. |

**Assessment:** the authenticated upload → transform → private retrieval/listing
workflow satisfies the core project flow. It does not implement every suggested
transformation: watermarking is absent. This is a demo backend completion, not a
claim that production deployment requires no further work.

## Final endpoints

| Method | Route | Authentication / purpose |
| --- | --- | --- |
| GET | `/api` | Public service greeting. |
| POST | `/api/auth/sign-up` | Public registration; 10/minute per IP. |
| POST | `/api/auth/sign-in` | Public login; 10/minute per IP. |
| GET | `/api/auth/profile` | JWT claims; 60/minute per IP. |
| POST | `/api/images/upload` | JWT; original upload; 10/minute per user. |
| GET | `/api/images?page=1&limit=10` | JWT; paginated records and URLs; 60/minute per user. |
| GET | `/api/images/:id` | JWT; selected original/version metadata and refreshed URLs; 60/minute per user. |
| POST | `/api/images/:id/transform` | JWT; nested operations against original; 10/minute per user. |
| DELETE | `/api/images/:id` | JWT; delete selected record, plus versions when deleting an original; 60/minute per user. |
| GET | `/api/docs` | Swagger UI. |
| GET | `/api/docs-json` | OpenAPI document. |

Quotas are separate per handler. Changing image IDs, user IPs, or JWTs does not
reset a user's transform quota. A 429 includes `Retry-After` seconds. Requests
rejected by DTO validation still count. The throttler uses a 60-second window
and 60-second block duration. Auth's IP limiter uses Express's resolved client
IP; untrusted forwarding headers are not read manually.

## Postman: successful request flow

Use `baseUrl = http://localhost:3000/api` and JSON unless stated otherwise.

1. `POST {{baseUrl}}/auth/sign-up`:
   `{"username":"ana","email":"ana@example.com","password":"ExamplePass123!"}`.
   Expect 201 and no password/hash in the response.
2. `POST {{baseUrl}}/auth/sign-in`:
   `{"email":"ana@example.com","password":"ExamplePass123!"}`.
   Save `accessToken`; set Bearer authorization for the following image requests.
3. `POST {{baseUrl}}/images/upload`: form-data `file` of type File. Let Postman
   generate the multipart boundary. Save `_id` as `originalId`. Expect 201,
   `kind: original`, metadata, `url`, `downloadUrl`, and `urlExpiresAt`.
4. `GET {{baseUrl}}/images?page=1&limit=10`: expect
   `{items,page,limit,total,totalPages}`. Other users' records must not appear.
5. `POST {{baseUrl}}/images/{{originalId}}/transform`:
   `{"transformations":{"resize":{"width":800},"rotate":90,"filters":{"sepia":true},"format":"webp","quality":75}}`.
   Save the returned `_id` as `versionId`; verify `originalImageId` and recipe.
6. `GET {{baseUrl}}/images/{{versionId}}`: open `url` in the browser to display it
   or `downloadUrl` to download it. Use the original ID to retrieve original bytes.
   The signed URLs themselves do not need a JWT; possession authorizes access.
7. `DELETE {{baseUrl}}/images/{{versionId}}`: removes only the version. Then
   delete `{{originalId}}`: removes the original and any remaining versions.

See [image-flow.md](image-flow.md) for individual transformation bodies and order.

## Postman: negative and boundary checklist

- Missing/invalid/expired JWT → 401. A valid token for user B must receive 404 for
  get/transform/delete of user A's IDs; user B's list must exclude user A's records.
- Invalid ObjectId, valid-but-missing ID → 404 before storage/signing.
- Missing file, disguised text as `.png`, unsupported GIF/SVG, unexpected file
  field or extra file → 400. Exactly 5 MiB and larger → 413 during multipart parsing.
- Empty/nested-null transformations, unsupported format, non-boolean flags,
  negative crop offsets, out-of-bounds crop, width/height/quality outside bounds,
  unexpected properties → 400. Damaged original decode → 422.
- `page=0`, `page=-1`, `page=1.5`, `page=abc`, empty values, duplicate query
  parameters, `limit=0`, `limit=51`, unknown query properties → 400.
- Empty collection → `items: []`, `total: 0`, `totalPages: 0`. A page beyond the
  end is empty but retains total. Equal timestamps sort by descending ID.
- Make 11 transforms within a minute (including across image IDs) → 429 on the
  11th; inspect Retry-After. A different authenticated user has its own quota.
- Block an S3 operation/signing in a test environment → safe 502. Unexpected
  database failures → generic 500 without stack traces or connection details.
- Expired URL → S3 rejects access; fetch the owned record again for fresh URLs.
  Ensure the same object is not accessible through its unsigned URL.
- Repeated transforms preserve original bytes and use new keys; deletion removes
  expected objects. Verify GET-generated URLs work with the actual bucket policy.

## Audit findings and deployment debt

- **JWT lifetime:** current AuthModule does not configure `expiresIn`; issued
  tokens are long-lived. Choose a finite lifetime and a refresh/re-login policy
  before deployment. Changing this behavior was intentionally left separate from
  retrieval/pagination work. Existing no-expiry tokens also need an invalidation
  plan (e.g. deliberate signing-key rotation).
- **Multipart dependencies:** Nest platform-express was updated within the
  existing 12.x range to 12.0.3, bringing Multer 2.4.0 and clearing the identified
  production upload-parser advisories. No force audit fix or major upgrade was
  applied. Production audit reports zero known advisories at this check.
- **Dev tooling advisories:** npm still reports five findings (two high) through
  existing `@nestjs/mau` deployment tooling (`undici`, `tmp`, and their parents).
  Review/update or remove unused deployment tooling before relying on it. The
  suggested npm force fix changes its version across an incompatible boundary;
  it was not applied blindly.
- **Memory and concurrency:** rate limits do not cap concurrent jobs or total
  decoded pixels. Sharp stages hold decoded/intermediate buffers; enforce a
  workload-appropriate pixel budget, concurrency and timeouts before hostile
  public traffic. Large-scale worker queues remain optional until required.
- **S3/MongoDB consistency:** uploads compensate failed metadata writes by
  best-effort deletion. Crashes/cleanup failures can leave orphan objects;
  concurrent transform/delete is not serialized. Add reconciliation and
  coordination before production. Signing fails after persistence without
  deleting the saved image; list/get can recover access once signing works.
- **In-memory quotas:** reset on restart and are separate across replicas. Keep
  this demo to one instance; design a shared limiter only when scaling requires it.
  Configure Express trust proxy to the actual trusted deployment topology if
  needed for auth IP limits, never blindly trust arbitrary X-Forwarded-For.
- **Private storage:** verify least-privilege GetObject/PutObject/DeleteObject
  access for original, transformed, and any legacy prefixes, public-access blocks,
  HTTPS, and lifecycle policy. Presigned links are bearer links; do not log/share
  them. They are not revocable per JWT and may expire earlier with credentials.
  Follow-up S3 responses, including missing-object errors, happen directly at S3.
- **Credentials:** existing S3Service loads static credentials from configuration.
  Prefer deployment roles/temporary credentials before production. A targeted
  pattern scan of 22 reachable Git revisions (105 unique blobs) found no likely
  committed credentials: three URI hits were username/password placeholders in
  `.env.example`; no private `.env` appeared in history. This is not an exhaustive
  secret-scanner guarantee. Runtime `.env` values were never printed.
- **Indexes:** provision `{user:1, createdAt:-1, _id:-1}` and the existing
  originalImageId index if automatic index creation is disabled. Large offsets
  still cost work; cursor pagination is a future option. Count/page reads are
  not a transactional snapshot during concurrent writes.
- **Auth edge cases:** concurrent duplicate registrations can still race the
  friendly email precheck and reach Mongo's unique constraint as a generic 500;
  normalize this conflict before production. Also review password byte-length
  policy (bcrypt's byte limit versus DTO character limits) and trimmed usernames.
- **Browser deployment:** configure an explicit API CORS allowlist and S3 CORS
  if a future frontend uses cross-origin fetch/canvas. No React frontend or
  permissive blanket CORS setup was introduced.

## Code and verification audit

No active local-filesystem upload path or duplicate processing pipeline was found.
Removed obsolete commented auth imports and three tracked zero-byte shell-artifact
files (`image-processing-service@0.0.1`, `jest`, `oxlint`). Ignored local `uploads/`
data was not removed. Endpoint names remain consistent with the existing project.
Swagger examples retain the nested Day 2 request shape and document the new URLs,
pagination envelope, quotas and status codes. No persisted URL fields or destructive
database migration were introduced.

Run:

```bash
npm run lint
npm test -- --runInBand
npm run build
git diff --check
npm run test:http
npm run test:e2e -- --runInBand
```

Unit/contract tests exercise real Sharp, offline AWS signing, DTO validation,
Mongoose schema validation and real throttle storage. `test:http` builds then uses
Node's test runner against a local listener, real JWT/bcrypt/Sharp/guards/controllers,
and in-memory substitutes for S3 and MongoDB. It covers the entire successful flow,
ownership, multipart limits, pagination, safe errors, and actual HTTP 429 responses.
The greeting e2e test is isolated from production environment variables and database
connections. Live S3/MongoDB deployment validation is still required.

## Remaining optional enhancements

Watermarking should reference a separately uploaded, owned image ID with validated
size/position/opacity, then composite after filters. Caching/deduplication, CDN
integration, multi-frame processing, refresh-token workflows, cursor pagination,
and background queues can be added when justified. No RabbitMQ, Kafka, or Redis
was introduced to satisfy a checklist.

## Final verification results

- `npm run lint`: passed.
- `npm test -- --runInBand`: 160 tests passed across 6 suites.
- `npm run build`: passed.
- `git diff --check`: passed.
- `npm run test:http`: 2 full HTTP regression tests passed, including acceptance
  at 5 MiB minus one byte, rejection at/above 5 MiB, and actual 429 responses.
- `npm run test:e2e -- --runInBand`: 1 greeting e2e test passed.

The final review retained Multer 2.4's inclusive size limit, clarified the
upload error documentation, and added the correct sign-up success example.
No Redis, RabbitMQ, Kafka, or frontend functionality was introduced.

Suggested commit message: `feat: finish private image retrieval, pagination and rate limiting`
