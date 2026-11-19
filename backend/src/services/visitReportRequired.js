// Human-readable create errors. Do not echo raw field identifiers such as
// `title` or `visitDate` — the form already uses those names in English.

export function missingCreateFieldsError(title, visitDate) {
  const noTitle = !String(title ?? '').trim();
  const noDate = visitDate == null || String(visitDate).trim() === '';
  if (noTitle && noDate) return '请填写标题和拜访日期';
  if (noTitle) return '请填写标题';
  if (noDate) return '请填写拜访日期';
  return null;
}
