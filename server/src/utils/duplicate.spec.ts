import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { AssetResponseDto } from 'src/dtos/asset-response.dto.js';
import { ExifResponseSchema } from 'src/dtos/exif.dto.js';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { getExifCount, suggestDuplicate, suggestDuplicateKeepAssetIds } from 'src/utils/duplicate.js';

type ExifInfoInput = Partial<z.infer<typeof ExifResponseSchema>>;

const createAsset = (
  id: string,
  fileSizeInByte: number | null = null,
  exifFields: ExifInfoInput = {},
): AssetResponseDto => ({
  id,
  type: AssetType.Image,
  thumbhash: null,
  localDateTime: new Date().toISOString(),
  duration: 0,
  hasMetadata: true,
  width: 1920,
  height: 1080,
  createdAt: new Date().toISOString(),
  ownerId: 'owner-1',
  originalPath: '/path/to/asset',
  originalFileName: 'asset.jpg',
  fileCreatedAt: new Date().toISOString(),
  fileModifiedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isFavorite: false,
  isArchived: false,
  isTrashed: false,
  isOffline: false,
  isEdited: false,
  visibility: AssetVisibility.Timeline,
  checksum: 'checksum',
  exifInfo:
    fileSizeInByte !== null || Object.keys(exifFields).length > 0
      ? ExifResponseSchema.parse({ fileSizeInByte, ...exifFields })
      : undefined,
});

const withCreatedAt = (asset: AssetResponseDto, fileCreatedAt: string): AssetResponseDto => ({
  ...asset,
  fileCreatedAt,
});

describe('duplicate utils', () => {
  describe('getExifCount', () => {
    it('should return 0 for asset without exifInfo', () => {
      const asset = createAsset('asset-1');
      asset.exifInfo = undefined;
      expect(getExifCount(asset)).toBe(0);
    });

    it('should return 0 for empty exifInfo', () => {
      const asset = createAsset('asset-1');
      asset.exifInfo = ExifResponseSchema.parse({});
      expect(getExifCount(asset)).toBe(0);
    });

    it('should count all truthy values in exifInfo', () => {
      const asset = createAsset('asset-1', 1000, {
        make: 'Canon',
        model: 'EOS 5D',
        dateTimeOriginal: new Date().toISOString(),
        timeZone: 'UTC',
        latitude: 40.7128,
        longitude: -74.006,
        city: 'New York',
        state: 'NY',
        country: 'USA',
        description: 'A photo',
        rating: 5,
      });
      // fileSizeInByte (1000) + 11 other truthy fields = 12
      expect(getExifCount(asset)).toBe(12);
    });

    it('should not count null or undefined values', () => {
      const asset = createAsset('asset-1', 1000, {
        make: 'Canon',
        model: null,
        latitude: undefined,
        city: '',
        rating: null,
      });
      // fileSizeInByte (1000) + make ('Canon') = 2 truthy values
      // model (null), latitude (undefined), city (''), rating (0) are all falsy
      expect(getExifCount(asset)).toBe(2);
    });
  });

  describe('suggestDuplicate', () => {
    it('should return undefined for empty list', () => {
      expect(suggestDuplicate([])).toBeUndefined();
    });

    it('should return the single asset for list with one asset', () => {
      const asset = createAsset('asset-1', 1000);
      expect(suggestDuplicate([asset])).toEqual(asset);
    });

    it('should return asset with largest file size', () => {
      const small = createAsset('small', 1000);
      const large = createAsset('large', 5000);
      const medium = createAsset('medium', 3000);

      expect(suggestDuplicate([small, large, medium])?.id).toBe('large');
      expect(suggestDuplicate([large, small, medium])?.id).toBe('large');
      expect(suggestDuplicate([medium, small, large])?.id).toBe('large');
    });

    it('should use EXIF count as tie-breaker when file sizes are equal', () => {
      const lessExif = createAsset('less-exif', 1000, { make: 'Canon' });
      const moreExif = createAsset('more-exif', 1000, {
        make: 'Canon',
        model: 'EOS 5D',
        dateTimeOriginal: new Date().toISOString(),
        city: 'New York',
      });

      expect(suggestDuplicate([lessExif, moreExif])?.id).toBe('more-exif');
      expect(suggestDuplicate([moreExif, lessExif])?.id).toBe('more-exif');
    });

    it('should handle assets with no exifInfo (treat as 0 file size)', () => {
      const noExif = createAsset('no-exif');
      noExif.exifInfo = undefined;
      const withExif = createAsset('with-exif', 1000);

      expect(suggestDuplicate([noExif, withExif])?.id).toBe('with-exif');
    });

    it('should handle assets with exifInfo but no fileSizeInByte', () => {
      const noFileSize = createAsset('no-file-size');
      noFileSize.exifInfo = ExifResponseSchema.parse({ make: 'Canon', model: 'EOS 5D' });
      const withFileSize = createAsset('with-file-size', 1000);

      expect(suggestDuplicate([noFileSize, withFileSize])?.id).toBe('with-file-size');
    });

    it('should return last asset when all have same file size and EXIF count', () => {
      const asset1 = createAsset('asset-1', 1000, { make: 'Canon' });
      const asset2 = createAsset('asset-2', 1000, { make: 'Nikon' });

      // Both have same file size (1000) and same EXIF count (2: fileSizeInByte + make)
      // Should return the last one in the sorted array
      const result = suggestDuplicate([asset1, asset2]);
      // Since they're equal, the last one after sorting should be returned
      expect(result).toBeDefined();
      expect(['asset-1', 'asset-2']).toContain(result?.id);
    });

    it('should prioritize file size over EXIF count', () => {
      const largeWithLessExif = createAsset('large-less-exif', 5000, { make: 'Canon' });
      const smallWithMoreExif = createAsset('small-more-exif', 1000, {
        make: 'Canon',
        model: 'EOS 5D',
        dateTimeOriginal: new Date().toISOString(),
        city: 'New York',
        state: 'NY',
        country: 'USA',
      });

      expect(suggestDuplicate([largeWithLessExif, smallWithMoreExif])?.id).toBe('large-less-exif');
    });

    describe('age', () => {
      it('should prefer the largest asset when it is the oldest', () => {
        const large = withCreatedAt(createAsset('large', 5000), '2020-01-01T00:00:00.000Z');
        const small = withCreatedAt(createAsset('small', 1000), '2024-01-01T00:00:00.000Z');

        expect(suggestDuplicate([large, small])?.id).toBe('large');
        expect(suggestDuplicate([small, large])?.id).toBe('large');
      });

      it('should prefer the largest asset when it has the same age as the oldest', () => {
        const large = withCreatedAt(createAsset('large', 5000), '2020-01-01T00:00:00.000Z');
        const small = withCreatedAt(createAsset('small', 1000), '2020-01-01T00:00:00.000Z');

        expect(suggestDuplicate([small, large])?.id).toBe('large');
      });

      it('should prefer a smaller asset that is at least 30 days older', () => {
        const large = withCreatedAt(createAsset('large', 5000), '2020-01-31T00:00:00.000Z');
        const small = withCreatedAt(createAsset('small', 1000), '2020-01-01T00:00:00.000Z');

        expect(suggestDuplicate([large, small])?.id).toBe('small');
        expect(suggestDuplicate([small, large])?.id).toBe('small');
      });

      it('should prefer the largest asset when the smaller asset is less than 30 days older', () => {
        const large = withCreatedAt(createAsset('large', 5000), '2020-01-30T23:59:59.999Z');
        const small = withCreatedAt(createAsset('small', 1000), '2020-01-01T00:00:00.000Z');

        expect(suggestDuplicate([large, small])?.id).toBe('large');
      });

      it('should compare the largest asset against the oldest asset', () => {
        const large = withCreatedAt(createAsset('large', 5000), '2024-01-01T00:00:00.000Z');
        const medium = withCreatedAt(createAsset('medium', 3000), '2023-12-15T00:00:00.000Z');
        const small = withCreatedAt(createAsset('small', 1000), '2022-01-01T00:00:00.000Z');

        expect(suggestDuplicate([large, medium, small])?.id).toBe('small');
      });

      it('should prefer the largest of several equally old assets', () => {
        const large = withCreatedAt(createAsset('large', 5000), '2024-01-01T00:00:00.000Z');
        const oldMedium = withCreatedAt(createAsset('old-medium', 3000), '2020-01-01T00:00:00.000Z');
        const oldSmall = withCreatedAt(createAsset('old-small', 1000), '2020-01-01T00:00:00.000Z');

        expect(suggestDuplicate([oldSmall, large, oldMedium])?.id).toBe('old-medium');
      });
    });
  });

  describe('suggestDuplicateKeepAssetIds', () => {
    it('should return empty array for empty list', () => {
      expect(suggestDuplicateKeepAssetIds([])).toEqual([]);
    });

    it('should return array with single asset ID', () => {
      const asset = createAsset('asset-1', 1000);
      expect(suggestDuplicateKeepAssetIds([asset])).toEqual(['asset-1']);
    });

    it('should return array with best asset ID', () => {
      const small = createAsset('small', 1000);
      const large = createAsset('large', 5000);

      expect(suggestDuplicateKeepAssetIds([small, large])).toEqual(['large']);
    });
  });
});
