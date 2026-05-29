// ─── S3 Object Storage ───────────────────────────────────────────────────────
// Stub implementation. Activate by:
//   1. `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
//   2. Set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
//   3. STORAGE_PROVIDER=s3
//
// We don't include the SDK by default because it's ~5MB and the disk
// adapter is fine for low-volume restaurants on Render Disks.

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ObjectStorage, StoredObject } from './object-storage.interface';

@Injectable()
export class S3StorageService implements ObjectStorage {
  private readonly logger = new Logger(S3StorageService.name);

  private get bucket(): string {
    const b = process.env.AWS_S3_BUCKET;
    if (!b) {
      throw new ServiceUnavailableException(
        'S3StorageService selected but AWS_S3_BUCKET is not set',
      );
    }
    return b;
  }

  async put(key: string, contentType: string, bytes: Buffer): Promise<StoredObject> {
    void this.bucket;
    // Real impl:
    //   await this.s3.send(new PutObjectCommand({
    //     Bucket: this.bucket,
    //     Key: key,
    //     Body: bytes,
    //     ContentType: contentType,
    //     CacheControl: 'public, max-age=31536000, immutable',
    //   }));
    this.logger.warn(
      `[STUB] S3 put not yet implemented — key=${key} bytes=${bytes.length}`,
    );
    const region = process.env.AWS_REGION ?? 'us-east-1';
    return {
      key,
      url: `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`,
      provider: 's3',
    };
  }

  async delete(key: string): Promise<void> {
    void this.bucket;
    this.logger.warn(`[STUB] S3 delete not yet implemented — key=${key}`);
  }
}
