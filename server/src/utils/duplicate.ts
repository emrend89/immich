import { AssetResponseDto } from 'src/dtos/asset-response.dto.js';

/**
 * Counts all truthy values in the exifInfo object.
 * This matches the client implementation in web/src/lib/utils/exif-utils.ts
 *
 * @param asset Asset with optional exifInfo
 * @returns Count of truthy EXIF values
 */
export const getExifCount = (asset: AssetResponseDto): number => {
  return Object.values(asset.exifInfo ?? {}).filter(Boolean).length;
};

/**
 * Minimum number of days a smaller file must be older than the largest file to be preferred over it.
 */
export const DUPLICATE_AGE_THRESHOLD_DAYS = 30;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the creation time of an asset in milliseconds.
 * Assets without a valid creation date are treated as the newest, so they never win on age.
 */
const getCreatedAtMs = (asset: AssetResponseDto): number => {
  const time = new Date(asset.fileCreatedAt).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
};

/**
 * Picks the asset with the largest file size, using the EXIF count as tie-breaker.
 */
const getLargestAsset = (assets: AssetResponseDto[]): AssetResponseDto | undefined => {
  // Sort by file size ascending (smallest first)
  let duplicateAssets = [...assets].toSorted(
    (a, b) => (a.exifInfo?.fileSizeInByte ?? 0) - (b.exifInfo?.fileSizeInByte ?? 0),
  );

  // Get the largest file size (last element after sorting)
  const largestFileSize = duplicateAssets.at(-1)?.exifInfo?.fileSizeInByte ?? 0;

  // Filter to keep only assets with the largest file size
  duplicateAssets = duplicateAssets.filter((asset) => (asset.exifInfo?.fileSizeInByte ?? 0) === largestFileSize);

  // If there are multiple assets with the same file size, sort by EXIF count
  if (duplicateAssets.length >= 2) {
    duplicateAssets = duplicateAssets.toSorted((a, b) => getExifCount(a) - getExifCount(b));
  }

  // Return the last asset (highest EXIF count among highest file size)
  return duplicateAssets.at(-1);
};

/**
 * Suggests the best duplicate asset to keep from a list of duplicates.
 *
 * The best asset is determined by the following criteria:
 *  1. The largest file (by file size in bytes, EXIF count as tie-breaker) wins if it is also the oldest
 *  2. Otherwise the oldest file wins if it was created at least DUPLICATE_AGE_THRESHOLD_DAYS before the largest file
 *  3. Otherwise the largest file wins
 *
 * The age of a file is based on its creation date (fileCreatedAt).
 *
 * @param assets List of duplicate assets
 * @returns The best asset to keep, or undefined if empty list
 */
export const suggestDuplicate = (assets: AssetResponseDto[]): AssetResponseDto | undefined => {
  if (assets.length === 0) {
    return undefined;
  }

  const largest = getLargestAsset(assets);
  if (!largest) {
    return undefined;
  }

  // Find the oldest asset(s); if several share the oldest date, prefer the largest of them
  const oldestCreatedAt = Math.min(...assets.map((asset) => getCreatedAtMs(asset)));
  const oldest = getLargestAsset(assets.filter((asset) => getCreatedAtMs(asset) === oldestCreatedAt));

  const largestCreatedAt = getCreatedAtMs(largest);
  if (!oldest || largestCreatedAt <= oldestCreatedAt) {
    return largest;
  }

  return largestCreatedAt - oldestCreatedAt >= DUPLICATE_AGE_THRESHOLD_DAYS * DAY_IN_MS ? oldest : largest;
};

/**
 * Suggests the best duplicate asset IDs to keep from a list of duplicates.
 * Returns an array with a single asset ID (the best candidate), or empty if no assets.
 *
 * @param assets List of duplicate assets
 * @returns Array of suggested asset IDs to keep (0 or 1 element)
 */
export const suggestDuplicateKeepAssetIds = (assets: AssetResponseDto[]): string[] => {
  const suggested = suggestDuplicate(assets);
  return suggested ? [suggested.id] : [];
};
