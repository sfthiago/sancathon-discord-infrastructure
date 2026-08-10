export function sortBy(items, ...selectors) {
  return [...items].sort((left, right) => {
    for (const selector of selectors) {
      const leftValue = selector(left);
      const rightValue = selector(right);
      const comparison = String(leftValue ?? "").localeCompare(
        String(rightValue ?? ""),
        "pt-BR",
        { numeric: true },
      );
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

export function indexBy(items, selector) {
  return new Map(items.map((item) => [selector(item), item]));
}

export function unique(values) {
  return [...new Set(values)];
}
