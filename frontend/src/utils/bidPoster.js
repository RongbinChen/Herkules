// Draws a WeChat-friendly share poster (PNG) for a bid-opening record:
// project header, key fields, bidder/price table and a QR code linking to the
// public share page. Users long-press/save the image and send it as a picture
// — unlike pasted links, pictures always render nicely in WeChat.
import QRCode from 'qrcode'

const W = 750
const PAD = 44

function ellipsize(ctx, text, maxWidth) {
  let t = String(text ?? '')
  if (ctx.measureText(t).width <= maxWidth) return t
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1)
  return `${t}…`
}

export async function drawBidPoster(rec, shareUrl) {
  const bidders = Array.isArray(rec.bidders) ? rec.bidders : []
  const shown = bidders.slice(0, 8)
  const rowH = 78
  const tableTop = 300
  const tableH = 52 + shown.length * rowH + (bidders.length > shown.length ? 40 : 0)
  const qrTop = tableTop + tableH + 36
  const H = qrTop + 220 + 70

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // Background card
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(16, 16, W - 32, H - 32, 24)
  ctx.fill()
  ctx.stroke()

  // Header
  ctx.fillStyle = '#0284c7'
  ctx.font = '600 26px system-ui, -apple-system, sans-serif'
  ctx.fillText('HERKULES CRM · BID OPENING', PAD, 76)

  ctx.fillStyle = '#0f172a'
  ctx.font = '700 40px system-ui, -apple-system, sans-serif'
  ctx.fillText(ellipsize(ctx, rec.projectName || '(project name not recognized)', W - PAD * 2), PAD, 136)

  // Key fields
  ctx.font = '400 28px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = '#475569'
  const openDate = rec.openDate ? new Date(rec.openDate).toISOString().slice(0, 10) : '—'
  ctx.fillText(ellipsize(ctx, `No. ${rec.biddingNo || '—'}   ·   Opened ${openDate}`, W - PAD * 2), PAD, 188)
  if (rec.purchaser) {
    ctx.fillText(ellipsize(ctx, `End user: ${rec.purchaser}`, W - PAD * 2), PAD, 232)
  }

  // Divider
  ctx.strokeStyle = '#e2e8f0'
  ctx.beginPath()
  ctx.moveTo(PAD, 262)
  ctx.lineTo(W - PAD, 262)
  ctx.stroke()

  // Table header
  ctx.fillStyle = '#64748b'
  ctx.font = '600 24px system-ui, -apple-system, sans-serif'
  ctx.fillText('BIDDER', PAD, tableTop)
  ctx.fillText('PRICE', W - PAD - 220, tableTop)

  // Bidder rows
  shown.forEach((b, i) => {
    const y = tableTop + 52 + i * rowH
    ctx.fillStyle = '#0f172a'
    ctx.font = '600 28px system-ui, -apple-system, sans-serif'
    ctx.fillText(ellipsize(ctx, `${i + 1}. ${b.name}`, W - PAD * 2 - 240), PAD, y)
    ctx.fillStyle = '#334155'
    ctx.font = '500 26px system-ui, -apple-system, sans-serif'
    const price = [b.currency, b.price].filter(Boolean).join(' ') || '—'
    ctx.fillText(ellipsize(ctx, price, 230), W - PAD - 220, y)
    const sub = [b.country, b.priceTerm, b.deliveryTime].filter(Boolean).join(' · ')
    if (sub) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '400 22px system-ui, -apple-system, sans-serif'
      ctx.fillText(ellipsize(ctx, sub, W - PAD * 2 - 240), PAD, y + 32)
    }
  })
  if (bidders.length > shown.length) {
    ctx.fillStyle = '#94a3b8'
    ctx.font = '400 24px system-ui, -apple-system, sans-serif'
    ctx.fillText(`… and ${bidders.length - shown.length} more bidder(s)`, PAD, tableTop + 52 + shown.length * rowH)
  }

  // QR code + hint
  const qrData = await QRCode.toDataURL(shareUrl, { width: 200, margin: 1, color: { dark: '#0f172a' } })
  const qrImg = new Image()
  await new Promise((resolve, reject) => {
    qrImg.onload = resolve
    qrImg.onerror = reject
    qrImg.src = qrData
  })
  ctx.drawImage(qrImg, W - PAD - 200, qrTop, 200, 200)
  ctx.fillStyle = '#475569'
  ctx.font = '500 26px system-ui, -apple-system, sans-serif'
  ctx.fillText('Scan to view the full record', PAD, qrTop + 90)
  ctx.fillStyle = '#94a3b8'
  ctx.font = '400 22px system-ui, -apple-system, sans-serif'
  ctx.fillText('No login required · Herkules CRM', PAD, qrTop + 130)

  return canvas.toDataURL('image/png')
}
