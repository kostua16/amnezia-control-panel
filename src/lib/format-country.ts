/**
 * Convert an ISO 3166-1 alpha-2 country code into its flag emoji.
 * Shared by geo-routing components so the mapping lives in one place.
 */
export function countryCodeToFlag(code: string): string {
  return code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}
