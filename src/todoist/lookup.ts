export function findByCaseInsensitiveSubstring<T>(
  items: T[],
  needle: string,
  selectName: (item: T) => string | undefined,
): T | undefined {
  const normalizedNeedle = needle.toLowerCase();
  return items.find((item) => selectName(item)?.toLowerCase().includes(normalizedNeedle));
}

export type NameLookupResult<T> =
  | { kind: 'exact'; item: T }
  | { kind: 'unique_substring'; item: T }
  | { kind: 'ambiguous_exact'; matches: T[] }
  | { kind: 'ambiguous_substring'; matches: T[] }
  | { kind: 'none' };

export function findByCaseInsensitiveNameForMutation<T>(
  items: T[],
  needle: string,
  selectName: (item: T) => string | undefined,
): NameLookupResult<T> {
  const normalizedNeedle = needle.trim().toLowerCase();
  const namedItems = items
    .map((item) => ({ item, name: selectName(item)?.trim() }))
    .filter((entry): entry is { item: T; name: string } => Boolean(entry.name));

  const exactMatches = namedItems.filter((entry) => entry.name.toLowerCase() === normalizedNeedle).map((entry) => entry.item);
  if (exactMatches.length === 1) {
    return { kind: 'exact', item: exactMatches[0]! };
  }
  if (exactMatches.length > 1) {
    return { kind: 'ambiguous_exact', matches: exactMatches };
  }

  const substringMatches = namedItems.filter((entry) => entry.name.toLowerCase().includes(normalizedNeedle)).map((entry) => entry.item);
  if (substringMatches.length === 1) {
    return { kind: 'unique_substring', item: substringMatches[0]! };
  }
  if (substringMatches.length > 1) {
    return { kind: 'ambiguous_substring', matches: substringMatches };
  }

  return { kind: 'none' };
}

export function findById<T>(items: T[], id: string, selectId: (item: T) => string | undefined): T | undefined {
  return items.find((item) => selectId(item) === id);
}
