// Bilingual (English + Chinese) HTML layout for outgoing mail.
//
// Every block carries both languages and renders English first, Chinese under
// it in a muted tone — the reader picks one and skips the other, rather than
// two separate mails or a language guess based on the recipient.
//
// Written for mail clients, not browsers. That means: tables for layout,
// inline styles only (Gmail strips <style> in some views, Outlook ignores
// much of it), no flexbox/grid, no background images, explicit widths, and
// hex colours rather than tokens. It looks plain in a browser on purpose.
//
// Every function here also returns a plain-text twin. A text/plain part is not
// a fallback nobody sees — it is what shows in notification previews, what
// spam filters read, and what survives a client with images and HTML off.

const BRAND = '#1c6cb0';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const BG = '#f1f5f9';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif";

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TONES = {
  info: { bar: BRAND, chip: '#eff6ff', chipInk: '#1e40af' },
  alert: { bar: '#b45309', chip: '#fffbeb', chipInk: '#92400e' },
};

/**
 * @param {object} o
 * @param {{en:string, zh:string}} o.title      headline
 * @param {{en:string, zh:string}} [o.intro]    lead paragraph
 * @param {Array<{label?:string, title:string|{en:string,zh:string}, url?:string}>} [o.items]
 *        bulleted list; a plain-string title is content that has only one
 *        language anyway (an announcement headline), a {en,zh} pair stacks
 *        like every other block
 * @param {Array<{k:{en:string,zh:string}, v:string}>} [o.facts]         key/value rows
 * @param {{label:{en:string,zh:string}, url:string}} [o.action]         button
 * @param {{en:string, zh:string}} [o.note]     small print under the divider
 * @param {'info'|'alert'} [o.tone]
 * @returns {{html:string, text:string}}
 */
export function renderEmail({ title, intro, items = [], facts = [], action, note, tone = 'info' }) {
  const t = TONES[tone] || TONES.info;

  // A block written by a person — a status update, an enquiry — exists in one
  // language only, and the caller passes that same string as both en and zh.
  // Printing it twice reads like a rendering bug, so an identical (or missing)
  // second language collapses to a single paragraph.
  const monolingual = (b) => !b.zh || b.zh === b.en;

  const para = (b) => (monolingual(b)
    ? `
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${INK};">${esc(b.en)}</p>`
    : `
      <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:${INK};">${esc(b.en)}</p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:${MUTED};">${esc(b.zh)}</p>`);

  const itemBody = (it) => {
    const bi = it.title && typeof it.title === 'object';
    const head = bi ? it.title.en : it.title;
    const main = it.url
      ? `<a href="${esc(it.url)}" style="color:${BRAND};font-size:14px;font-weight:600;line-height:1.5;text-decoration:none;">${esc(head)}</a>`
      : `<span style="color:${INK};font-size:14px;font-weight:600;line-height:1.5;">${esc(head)}</span>`;
    return bi && !monolingual(it.title)
      ? `${main}<br><span style="color:${MUTED};font-size:13px;line-height:1.6;">${esc(it.title.zh)}</span>`
      : main;
  };

  const itemRows = items.map((it) => `
        <tr><td style="padding:0 0 10px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="border:1px solid ${LINE};border-radius:8px;">
            <tr><td style="padding:12px 14px;">
              ${it.label ? `<span style="display:inline-block;margin:0 0 6px;padding:2px 8px;border-radius:99px;background:${t.chip};color:${t.chipInk};font-size:11px;font-weight:700;">${esc(it.label)}</span><br>` : ''}
              ${itemBody(it)}
            </td></tr>
          </table>
        </td></tr>`).join('');

  const factRows = facts.map((f) => `
        <tr>
          <td style="padding:6px 12px 6px 0;font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top;">
            ${esc(f.k.en)}<br><span style="font-size:12px;">${esc(f.k.zh)}</span>
          </td>
          <td style="padding:6px 0;font-size:13px;color:${INK};vertical-align:top;">${esc(f.v)}</td>
        </tr>`).join('');

  // Preheader: the grey line clients show next to the subject. Left empty it
  // gets filled with whatever markup comes first, which reads like garbage.
  const preheader = `${title.en} · ${title.zh}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${esc(title.en)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BG};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
           style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${LINE};">

      <tr><td style="height:4px;background:${t.bar};font-size:0;line-height:0;">&nbsp;</td></tr>

      <tr><td style="padding:22px 28px 0;">
        <span style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED};">Herkules CRM</span>
      </td></tr>

      <tr><td style="padding:10px 28px 0;font-family:${FONT};">
        <h1 style="margin:0;font-size:21px;line-height:1.35;font-weight:700;color:${INK};">${esc(title.en)}</h1>
        <p style="margin:4px 0 0;font-size:16px;line-height:1.5;color:${MUTED};">${esc(title.zh)}</p>
      </td></tr>

      <tr><td style="padding:20px 28px 0;font-family:${FONT};">
        ${intro ? para(intro) : ''}
        ${items.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${itemRows}</table>` : ''}
        ${facts.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;">${factRows}</table>` : ''}
      </td></tr>

      ${action ? `
      <tr><td style="padding:12px 28px 0;font-family:${FONT};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-radius:8px;background:${BRAND};">
            <a href="${esc(action.url)}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
              ${esc(action.label.en)} · ${esc(action.label.zh)}
            </a>
          </td>
        </tr></table>
      </td></tr>` : ''}

      ${note ? `
      <tr><td style="padding:22px 28px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td style="border-top:1px solid ${LINE};padding-top:14px;font-family:${FONT};">
            <p style="margin:0 0 3px;font-size:12px;line-height:1.6;color:${MUTED};">${esc(note.en)}</p>
            ${monolingual(note) ? '' : `<p style="margin:0;font-size:12px;line-height:1.7;color:${MUTED};">${esc(note.zh)}</p>`}
          </td>
        </tr></table>
      </td></tr>` : ''}

      <tr><td style="padding:22px 28px 24px;font-family:${FONT};">
        <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8;">
          Automated message from Herkules CRM — please do not reply.<br>
          由 Herkules CRM 自动发送，请勿直接回复。
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  const textParts = [
    `${title.en}\n${title.zh}`,
    '='.repeat(48),
    intro ? (monolingual(intro) ? intro.en : `${intro.en}\n\n${intro.zh}`) : null,
    items.length ? items.map((i) => {
      const head = i.title && typeof i.title === 'object'
        ? (monolingual(i.title) ? i.title.en : `${i.title.en}\n  ${i.title.zh}`)
        : i.title;
      return `- ${i.label ? `[${i.label}] ` : ''}${head}${i.url ? `\n  ${i.url}` : ''}`;
    }).join('\n\n') : null,
    facts.length ? facts.map((f) => `${f.k.en} / ${f.k.zh}: ${f.v}`).join('\n') : null,
    action ? `${action.label.en} / ${action.label.zh}:\n${action.url}` : null,
    note ? (monolingual(note) ? `--\n${note.en}` : `--\n${note.en}\n${note.zh}`) : null,
    'Automated message from Herkules CRM — please do not reply.\n由 Herkules CRM 自动发送，请勿直接回复。',
  ].filter(Boolean);

  return { html, text: textParts.join('\n\n') };
}
