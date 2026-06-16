import type { ChainRoutingOptions, ChainTopology } from '@/types/chain';

export function parseDirectGeoipTagsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0 && tag !== 'private'),
    ),
  );
}

export function buildRoutingOptionsForTopology(
  topology: ChainTopology,
  directGeoipTagsInput: string,
): ChainRoutingOptions | undefined {
  if (topology !== 'split') {
    return undefined;
  }

  return {
    split: {
      directGeoipTags: parseDirectGeoipTagsInput(directGeoipTagsInput),
    },
  };
}

export function hasDirectGeoipTags(value: string): boolean {
  return parseDirectGeoipTagsInput(value).length > 0;
}
