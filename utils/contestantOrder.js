export function sortContestantsByNumber(contestants) {
  return [...contestants].sort((left, right) => {
    const leftNumber = String(left.number ?? "").trim();
    const rightNumber = String(right.number ?? "").trim();

    if (!leftNumber) return rightNumber ? 1 : 0;
    if (!rightNumber) return -1;

    return leftNumber.localeCompare(rightNumber, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}