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
     "transformations": {
       "resize": { "width": 800, "height": 600 },
       "rotate": 90,
       "mirror": true,
       "filters": { "grayscale": true },
       "format": "webp",
       "quality": 75
     }
   }
   ```

   `transformations` is required and must be non-empty. Only requested operations
   run. There is **no default resize**. Encoding defaults to WebP at quality 80.
   `false` flags and a zero-degree rotation are valid no-ops; the output is still
   encoded and saved as a new version.

### Individual transformation bodies

Use the same transform URL and Bearer token for every row. Set the body to raw
JSON. Dimensions/coordinates are pixels, rotation is degrees.

| Operation | Complete Postman JSON body |
| --- | --- |
| Resize | `{"transformations":{"resize":{"width":800,"height":600}}}` |
| Width only (preserve aspect ratio) | `{"transformations":{"resize":{"width":800}}}` |
| Height only (preserve aspect ratio) | `{"transformations":{"resize":{"height":600}}}` |
| Crop | `{"transformations":{"crop":{"width":500,"height":400,"x":10,"y":20}}}` |
| Rotate clockwise | `{"transformations":{"rotate":90}}` |
| Rotate counterclockwise/fractional | `{"transformations":{"rotate":-22.5}}` |
| Vertical flip | `{"transformations":{"flip":true}}` |
| Horizontal mirror | `{"transformations":{"mirror":true}}` |
| Quality/compression | `{"transformations":{"quality":60}}` |
| JPEG conversion | `{"transformations":{"format":"jpeg"}}` |
| PNG conversion | `{"transformations":{"format":"png"}}` |
| WebP conversion | `{"transformations":{"format":"webp"}}` |
| Grayscale | `{"transformations":{"filters":{"grayscale":true}}}` |
| Sepia | `{"transformations":{"filters":{"sepia":true}}}` |

### Combining operations and their order

For an original at least 510 × 420 pixels, this request exercises all operations:

```json
{
  "transformations": {
    "crop": { "width": 500, "height": 400, "x": 10, "y": 20 },
    "resize": { "width": 800, "height": 600 },
    "flip": true,
    "mirror": true,
    "rotate": 90,
    "filters": { "grayscale": true, "sepia": true },
    "format": "webp",
    "quality": 75
  }
}
```

The order is fixed; JSON property order does not change it:

1. **Decode the original**, using its stored pixel orientation (EXIF orientation
   is not automatically applied). Only the first frame of animated inputs is used.
2. **Crop** in original-image coordinates. `x` is left and `y` is top; both default
   to zero. The entire rectangle must fit the original. `left`/`top` aliases are
   not accepted.
3. **Resize** the crop (or whole original). One dimension preserves aspect ratio.
   Both dimensions keep Day 1's centered `cover` behavior and can trim edges.
4. **Flip vertically, then mirror horizontally**, in the resized image's axes.
5. **Rotate** clockwise for positive values. Arbitrary angles expand the canvas
   with a transparent background; JPEG renders that background black.
6. **Grayscale, then sepia**. When both are true, sepia colors the grayscale result.
   Sepia uses the RGB matrix `[[.393,.769,.189],[.349,.686,.168],[.272,.534,.131]]`.
7. **Encode once** with the chosen format and quality and save a new version.

Cropping first keeps coordinates stable against the original, resizing before
rotation makes the requested dimensions describe the pre-rotation image, and
color filters operate on the final geometry. Lossless raw pixel buffers separate
geometry stages so Sharp cannot reorder operations across them. This avoids
repeated lossy encoding, but requires memory for decoded/intermediate pixels.
The example above returns dimensions 600 × 800 after its 90-degree rotation.

Sharp's operation-order behavior is documented in its
[operations reference](https://sharp.pixelplumbing.com/api-operation/).

### Validation and manual checks

- Resize width/height: JSON integers, 1–4000; at least one is required.
- Crop width/height: required JSON integers, 1–4000. Offsets: nonnegative safe
  integers. Also test a crop ending exactly at the original boundary (accepted)
  and one extending a pixel past it (400).
- Rotation: finite JSON number between -360 and 360, including fractions.
- Quality: JSON integer, 1–100. PNG quality controls palette quantization;
  reduced byte size is not guaranteed for every image.
- Format: exactly `jpeg`, `png`, or `webp`.
- Flip, mirror, grayscale, sepia: actual JSON booleans. `"false"`, `"true"`, and
  `0`/`1` are rejected. Numeric strings such as `"800"` are also rejected.
- Empty request/transformations/resize/crop/filters, null values, arrays where
  objects are expected, and unknown properties at any nesting level return 400.
- Test a rotation alone, each filter alone, both filters together on a transparent
  PNG, and combined crop/resize/flip/mirror/rotate operations on an asymmetric image.
- Test another user's original ID, an invalid ID, and a nonexistent ID: all 404
  before any S3 read. Missing/invalid tokens return 401.
- Test old records without original bytes (409), a version ID as the source (400),
  a damaged stored original (422), and simulated S3 failures (502).
- Check that repeated transformations leave the original bytes unchanged and
  produce distinct keys and records with their applied options.

## Request flow and storage

- Upload: JWT → existing file size/type validation → original bytes to
  `originals/{userId}/{uuid}.{extension}` → MongoDB metadata → 201.
- Transform: JWT → validate body → find original by ID **and owner** → read
  original S3 object → validated Sharp operations/encoding → new object at
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
| `transformations` | Absent | Requested operations plus resolved encoding/crop-offset defaults |
| `createdAt`, `updatedAt` | Record timestamps | Version timestamps |

`GET /api/images` returns originals, versions, and legacy records, newest first.
Group versions by `originalImageId` in the frontend. `GET /api/images/:id`
returns an owned record. S3 keys are not download URLs.

`DELETE /api/images/:id` removes that record and object. For an original it also
removes its owned versions, processing versions first. Deleting a version does
not affect its original or siblings.

## Errors and partial failures

- 400: invalid transform input, out-of-bounds crop, invalid Sharp operation,
  unexpected options, invalid upload, or attempting
  to transform a version ID instead of an original ID.
- 401: missing, invalid, or expired JWT.
- 404: invalid MongoDB ID, nonexistent image, or another user's image. Storage is
  not accessed before the ownership check.
- 409: legacy record has no preserved original; re-upload required.
- 422: Sharp could not decode the stored original.
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

Day 1 transform clients must change their flat body into the nested body above:
`width`/`height` move into `transformations.resize`, and `quality`/`format` move into
`transformations`. `{}` is no longer accepted and the implicit 800px resize has
been removed so a rotate/filter/encoding-only request does only what it asks.
Numeric strings are no longer coerced; send JSON numbers. Upload remains unchanged.

New versions have an optional `transformations` metadata object with resolved
format/quality and crop offsets, plus explicitly supplied options (including
false flags). Historical versions remain valid without it; no database migration
or fabricated transformation history is needed. Original records still omit
quality, processedSize, and dimensions. Output dimensions are actual final sizes.

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

Watermarking is intentionally deferred. The clean extension is a nested
`watermark` object with an `imageId` referencing a separately uploaded original,
plus validated position, size, and opacity. Check ownership of that asset before
reading its S3 object and composite it after color filters and before encoding.
Do not accept arbitrary remote URLs or filesystem paths. No watermark request
field is accepted in this implementation.

Pagination and rate limiting remain Day 3 work and have not been added. Source
version selection and animated multi-frame processing are also not added.
