// ─── Local Disk Storage ──────────────────────────────────────────────────────
// Writes bytes under UPLOAD_DIR (default: ./uploads). On Render this can
// be a mounted Render Disk for persistence across deploys; on dev it's
// the working tree. The static middleware in main.ts already serves
// /uploads from this same dir.

import { Injectable, Logger } from '@nestjs/common';
import { join, extname } from 'path';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { ObjectStorage, StoredObject } from './object-storage.interface';

@Injectable()
export class DiskStorageService implements ObjectStorage {
  private readonly logger = new Logger(DiskStorageService.name);
  private readonly root = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

  constructor() {
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true });
  }

  async put(key: string, contentType: string, bytes: Buffer): Promise<StoredObject> {
    const safeKey = key.replace(/[^a-zA-Z0-9._/-]/g, '_');
    const ext = extname(safeKey) || this._extFromMime(contentType);
    const finalKey = safeKey.endsWith(ext) ? safeKey : `${safeKey}${ext}`;
    const fullPath = join(this.root, finalKey);
    await fs.mkdir(join(fullPath, '..'), { recursive: true });
    await fs.writeFile(fullPath, bytes);
    this.logger.log(`put ${finalKey} (${bytes.length} bytes)`);
    return {
      key: finalKey,
      url: `/uploads/${finalKey}`,
      provider: 'disk',
    };
  }

  async delete(key: string): Promise<void> {
    const fullPath = join(this.root, key);
    try {
      await fs.unlink(fullPath);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
    }
  }

  private _extFromMime(mime: string): string {
    switch (mime) {
      case 'image/jpeg': return '.jpg';
      case 'image/png':  return '.png';
      case 'image/webp': return '.webp';
      case 'model/gltf-binary': return '.glb';
      default: return '';
    }
  }
}
