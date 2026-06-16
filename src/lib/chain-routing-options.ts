import type { ChainRoutingOptions, ChainTopology } from '@/types/chain';

export const GEOIP_TAG_PATTERN = /^[a-z0-9_-]+$/i;

export interface DirectGeoipTagsParseResult {
  validTags: string[];
  invalidTags: string[];
}

export function normalizeDirectGeoipTagsInput(
  value: string | string[],
): DirectGeoipTagsParseResult {
  const rawTags = Array.isArray(value) ? value : value.split(',');
  const validTags: string[] = [];
  const invalidTags: string[] = [];
  const seenValidTags = new Set<string>();
  const seenInvalidTags = new Set<string>();

  for (const rawTag of rawTags) {
    const tag = rawTag.trim().toLowerCase();
    if (!tag || tag === 'private') {
      continue;
    }

    if (!GEOIP_TAG_PATTERN.test(tag)) {
      if (!seenInvalidTags.has(tag)) {
        invalidTags.push(tag);
        seenInvalidTags.add(tag);
      }
      continue;
    }

    if (!seenValidTags.has(tag)) {
      validTags.push(tag);
      seenValidTags.add(tag);
    }
  }

  return { validTags, invalidTags };
}

export function parseDirectGeoipTagsInput(value: string): string[] {
  return normalizeDirectGeoipTagsInput(value).validTags;
}

export function buildRoutingOptionsForTopology(
  topology: ChainTopology,
  directGeoipTagsInput: string,
): ChainRoutingOptions | undefined {
  if (topology !== 'split') {
    return undefined;
  }
  const { validTags, invalidTags } =
    normalizeDirectGeoipTagsInput(directGeoipTagsInput);
  if (invalidTags.length > 0) {
    throw new Error(`Invalid split GeoIP zone tag: ${invalidTags[0]}`);
  }

  return {
    split: {
      directGeoipTags: validTags,
    },
  };
}

export function hasDirectGeoipTags(value: string): boolean {
  const { validTags, invalidTags } = normalizeDirectGeoipTagsInput(value);
  return validTags.length > 0 && invalidTags.length === 0;
}

export function getInvalidDirectGeoipTags(value: string): string[] {
  return normalizeDirectGeoipTagsInput(value).invalidTags;
}
