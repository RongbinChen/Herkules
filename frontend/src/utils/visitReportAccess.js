// Show Delete only when this user may delete the report.
// The server flag wins. When an older payload omits it, fall back to the same
// rule the API enforces: credited author (uploader) or admin.
export function showDeleteVisitReport(report, user) {
  if (!report || !user) return false
  if (report.canDelete === true) return true
  if (report.canDelete === false) return false
  const authorId = Number.isInteger(report.authorId) ? report.authorId : report.author?.id
  return user.isAdmin === true || (Number.isInteger(authorId) && authorId === user.id)
}
