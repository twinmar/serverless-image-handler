import {
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  ImageHandlerError,
  StatusCodes,
} from "../../lib";

import { getAllowedSourceBuckets } from "../../image-request";

export async function getS3Image(
  s3Client: S3Client,
  bucket: string,
  key: string
): Promise<Buffer> {
  if (!bucket) {
    throw new ImageHandlerError(
      StatusCodes.BAD_REQUEST,
      "Template::MissingBucket",
      "A bucket is required to load a template image."
    );
  }

  if (!getAllowedSourceBuckets().includes(bucket)) {
    throw new ImageHandlerError(
      StatusCodes.FORBIDDEN,
      "ImageBucket::CannotAccessBucket",
      "The requested image bucket is not in SOURCE_BUCKETS."
    );
  }

  const result = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  if (!result.Body) {
    throw new ImageHandlerError(
      StatusCodes.NOT_FOUND,
      "Template::ImageNotFound",
      `Template image could not be loaded: ${key}`
    );
  }

  return Buffer.isBuffer(result.Body)
    ? result.Body
    : Buffer.from(
        await result.Body.transformToByteArray()
      );
}