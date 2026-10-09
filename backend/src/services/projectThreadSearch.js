// Query notice text in PostgreSQL, returning only ids rather than sending all
// announcement bodies to the tracking page. A match in ANY notice keeps the
// project's complete timeline and its actual latest lifecycle stage.
const SEARCH_FIELDS = [
  'projectName', 'projectCode', 'purchaser', 'winner', 'manufacturer',
  'threadKey', 'equipmentType', 'region', 'summary', 'rawContent',
];

export async function findMatchingAnnouncementIds(prisma, query) {
  const keyword = query == null ? '' : String(query).trim();
  if (!keyword) return null;
  const matches = await prisma.bidProject.findMany({
    where: {
      OR: SEARCH_FIELDS.map((field) => ({
        [field]: { contains: keyword, mode: 'insensitive' },
      })),
    },
    select: { id: true },
  });
  return new Set(matches.map((notice) => notice.id));
}

export function filterThreadsByAnnouncementMatches(threads, matchingIds) {
  if (matchingIds === null) return threads;
  return threads.filter((thread) =>
    thread.announcements.some((notice) => matchingIds.has(notice.id)));
}
