import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readSecret } from "./secrets.js";

export function createObjectStorage({
  endpoint = process.env.S3_ENDPOINT,
  region = process.env.S3_REGION ?? "us-east-1",
  bucket = process.env.S3_BUCKET ?? "platform-files",
  accessKeyId = resolveOptionalSecret({
    value: process.env.S3_ACCESS_KEY,
    file: process.env.S3_ACCESS_KEY_FILE,
    name: "S3 access key",
  }),
  secretAccessKey = resolveOptionalSecret({
    value: process.env.S3_SECRET_KEY,
    file: process.env.S3_SECRET_KEY_FILE,
    name: "S3 secret key",
  }),
} = {}) {
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 endpoint and credentials are required");
  }

  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  return {
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    },

    async putObject({ key, body, contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async getObject(key) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return Buffer.from(await result.Body.transformToByteArray());
    },

    close() {
      client.destroy();
    },
  };
}

function resolveOptionalSecret(options) {
  if (!options.value && !options.file) return undefined;
  return readSecret(options);
}
