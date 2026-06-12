/** Background bar color class for a resource usage percentage. */
export function getUsageColor(percent: number): string {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-yellow-500';
  return 'bg-green-500';
}

/** Text color class for a resource usage percentage. */
export function getUsageTextColor(percent: number): string {
  if (percent >= 90) return 'text-red-500';
  if (percent >= 70) return 'text-yellow-500';
  return 'text-green-500';
}
