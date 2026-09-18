# Original uploads and transformed versions

The application uses the `/api` global prefix. Swagger UI is at `/api/docs`.
All image endpoints require `Authorization: Bearer <accessToken>`.

## Requests in Postman

1. **Upload:** `POST http://localhost:3000/api/images/upload`
   - Authorization: Bearer Token, using the token returned by sign-in.
   - Body: **form-data**, key `file`, type **File**, select a JPEG, PNG, or WebP.
   - Let Postman generate the multipart Content-Type and boundary.
   - File size must be less than 5 MiB (5,242,880 bytes).
   - Save `_id` from the 201 response as `originalImageId`.
   - Upload no longer processes images or takes transformation query options.
2. **Transform:** `POST http://localhost:3000/api/images/{{originalImageId}}/transform`
   - Authorization: the same Bearer Token.
   - Body: **raw / JSON** (`Content-Type: application/json`):

   ```json
   {
     "width": 1200,
     "height": 800,
     "quality": 85,
     "format": "webp"
   }
   ```

   All four fields are optional. `{}` uses width 800, quality 80, and WebP.
   Width/height must be integers between 1 and 4000; quality must be an integer
   between 1 and 100; format must be `jpeg`, `png`, or `webp`.
   An omitted height preserves aspect ratio. Specifying both dimensions keeps
   the previous Sharp resize behavior (cover, which can trim the edges).
   No explicit crop options have been added.

## Request flow and storage

- Upload: JWT → existing file size/type validation → original bytes to
  `originals/{userId}/{uuid}.{extension}` → MongoDB metadata → 201.
- Transform: JWT → validate body → find original by ID **and owner** → read
  original S3 object → Sharp resize/encoding → new object at
  `transformed/{userId}/{originalImageId}/{uuid}.{format}` → metadata → 201.

Upload does not re-encode the file. The file validator sets the MIME type from
its detected bytes, so extensions and content types do not trust the client's
filename or MIME header. UUID filenames prevent repeated requests from
replacing the original or a previous version.

The existing `images` collection stores both record types:

| Field | Original | Transformed version |
| --- | --- | --- |
| `kind` | `original` | `transformed` |
| `user` | Owner ID | Same owner ID |
| `originalImageId` | Absent | Original record ID |
| `originalName` | Client's filename | Original client's filename |
| `originalKey` | Original S3 key | Same original S3 key |
| `path` | Original S3 key | Version's S3 key |
| `filename`, `mimeType`, `format` | Stored original's details | Version's details |
| `originalSize` | Original byte count | Same original byte count |
| `width`, `height` | Absent | Actual output dimensions |
| `quality`, `processedSize` | Absent | Applied quality and output byte count |
| `createdAt`, `updatedAt` | Record timestamps | Version timestamps |

`GET /api/images` returns originals, versions, and legacy records, newest first.
Group versions by `originalImageId` in the frontend. `GET /api/images/:id`
returns an owned record. S3 keys are not download URLs.

`DELETE /api/images/:id` removes that record and object. For an original it also
removes its owned versions, processing versions first. Deleting a version does
not affect its original or siblings.

## Errors and partial failures

- 400: invalid transform input, unexpected options, invalid upload, or attempting
  to transform a version ID instead of an original ID.
- 401: missing, invalid, or expired JWT.
- 404: invalid MongoDB ID, nonexistent image, or another user's image. Storage is
  not accessed before the ownership check.
- 409: legacy record has no preserved original; re-upload required.
- 422: Sharp could not decode/process the stored original.
- 502: S3 retrieval, upload, or deletion failure. Raw AWS errors are not returned.
- 500: database failure. If metadata creation fails after an upload, the service
  attempts to delete the newly uploaded object.

MongoDB and S3 do not share a transaction. Cleanup is best effort; a crash or a
cleanup failure can leave an orphan object. Cascade deletion can partially
complete and can be retried. Concurrent delete/transform operations are not
serialized; avoid transforming an image while deleting it. Durable background
cleanup and concurrency coordination are outside this foundation.

## Existing records and deployment

No destructive migration is performed. Legacy records keep their old `path`
(e.g. `processed/...`), quality, sizes, and requested dimensions. New fields have
no defaults that would mislabel those processed files as originals. Listing,
retrieval, and deletion continue to work.

Legacy records cannot be transformed because the previous flow never stored
the original bytes. Re-upload the original to get a new original ID. Do not copy
the old processed key into `originalKey` or label an old record `original`.

Clients must move transformation options from upload query parameters into the
new transform JSON body. They must tolerate originals without `quality`,
`processedSize`, or dimensions. Versions now report actual output dimensions;
legacy dimensions remain the old requested values.

Verify the existing deployment's S3 policy permits `GetObject` for the originals
prefix and `PutObject`/`DeleteObject` for both new prefixes. No IAM policy or AWS
configuration is modified by this change. The new `originalImageId` index is
created through normal Mongoose index management; deployments with auto-indexing
disabled should provision that index through their usual migration process.

## Verification and later work

Unit tests use mocked S3/MongoDB and real Sharp image bytes. API metadata and
validation tests verify the new Swagger contract and existing DTO limits.
Before deployment, exercise upload, transform, list, retrieve, and delete in
Swagger/Postman against the configured MongoDB/S3 environment, including
requests from a second user. Verify original bytes and version keys in S3.

Day 2 features are intentionally absent: explicit crop, rotate, filters,
watermark, flip, and other additional transforms. No Day 3 features are added.
