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

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the local calendar day an asset was created on, as days since the epoch.
 * localDateTime is timezone-agnostic, so this matches the day shown in the timeline.
 * Assets without a valid date are treated as the newest, so they never win on age.
 */
const getCreatedDay = (asset: AssetResponseDto): number => {
  const time = new Date(asset.localDateTime).getTime();
  return Number.isNaN(time) ? Infinity : Math.floor(time / DAY_IN_MS);
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
 *  1. Oldest creation day (local calendar day of localDateTime)
 *  2. Largest image file size in bytes (for assets created on the same day)
 *  3. Largest count of EXIF data (as tie-breaker)
 *
 * @param assets List of duplicate assets
 * @returns The best asset to keep, or undefined if empty list
 */
export const suggestDuplicate = (assets: AssetResponseDto[]): AssetResponseDto | undefined => {
  if (assets.length === 0) {
    return undefined;
  }

  const oldestDay = Math.min(...assets.map((asset) => getCreatedDay(asset)));
  return getLargestAsset(assets.filter((asset) => getCreatedDay(asset) === oldestDay));
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
