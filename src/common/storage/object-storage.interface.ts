// ─── Object Storage Interface ────────────────────────────────────────────────
// Lets MenuService and UsersService write uploaded photos/GLBs without
// caring whether the bytes land on local disk, a Render Disk mount, or
// S3. The current schema still stores blobs inline in Mongo for legacy
// items — new uploads go through this interface and store only the URL
// on the document.

export interface StoredObject {
  /// Absolute or relative URL the client can fetch. For 's3' it'll be a
  /// public CDN URL; for 'disk' it'll be `/uploads/<key>`.
  url: string;
  /// Logical key used to delete or replace the object later.
  key: string;
  /// Provider name for logging / reconciliation.
  provider: string;
}

export interface ObjectStorage {
  put(
    key: string,
    contentType: string,
    bytes: Buffer,
  ): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
