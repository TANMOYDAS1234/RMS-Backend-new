// ─── Object Storage Module ───────────────────────────────────────────────────
// Resolves OBJECT_STORAGE to disk (default) or S3 based on STORAGE_PROVIDER.
// Global so MenuService / UsersService can inject directly.

import { Global, Module } from '@nestjs/common';
import { OBJECT_STORAGE } from './object-storage.interface';
import { DiskStorageService } from './disk-storage.service';
import { S3StorageService } from './s3-storage.service';

@Global()
@Module({
  providers: [
    DiskStorageService,
    S3StorageService,
    {
      provide: OBJECT_STORAGE,
      useFactory: (disk: DiskStorageService, s3: S3StorageService) => {
        const provider = (process.env.STORAGE_PROVIDER ?? 'disk').toLowerCase();
        switch (provider) {
          case 's3':
            return s3;
          case 'disk':
          default:
            return disk;
        }
      },
      inject: [DiskStorageService, S3StorageService],
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
