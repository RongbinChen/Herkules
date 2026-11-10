import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJsxModule } from '../test/loadJsx.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { year: '2-digit', month: '2-digit', day: '2-digit' })

function renderCard(ThreadCard, thread) {
  return renderToStaticMarkup(createElement(ThreadCard, {
    thread,
    onSaved: () => {},
    onCustomer: () => {},
  }))
}

const published = '2026-09-29T12:00:00.000Z'
const scraped = '2026-08-24T12:00:00.000Z'

test('the card shows the latest notice date as Published, not the scrape time', async () => {
  const { ThreadCard } = await loadJsxModule(path.join(here, 'BidTrackingBoard.jsx'))
  const html = renderCard(ThreadCard, {
    threadKey: '0747-2640SCCSC259',
    projectName: 'Procurement of 0747-2640SCCSC259 Generator rotor',
    purchaser: 'erzhongdeyang',
    currentStage: 'AWARD',
    lastPublished: published,
    lastUpdate: scraped,
    announcements: [
      { id: 1, publishDate: '2026-08-21T12:00:00.000Z', infoClass: 'New Tenders', round: 1 },
      { id: 3, publishDate: published, infoClass: 'Tender Awards', round: 1 },
    ],
  })

  assert.match(html, new RegExp(`Published ${fmt(published).replaceAll('/', '\\/')}`))
  assert.doesNotMatch(html, /Updated/)
  assert.doesNotMatch(html, new RegExp(fmt(scraped).replaceAll('/', '\\/')))
  assert.match(html, /Publication date of the latest notice/)
})

test('a project with no notice date does not show a publication or Updated label', async () => {
  const { ThreadCard } = await loadJsxModule(path.join(here, 'BidTrackingBoard.jsx'))
  const html = renderCard(ThreadCard, {
    threadKey: 'no-publish-date',
    projectName: 'Procurement with no parsed notice date',
    currentStage: 'TENDER',
    lastPublished: null,
    lastUpdate: scraped,
    announcements: [
      { id: 9, publishDate: null, infoClass: 'New Tenders', round: 1 },
    ],
  })

  assert.doesNotMatch(html, /Published/)
  assert.doesNotMatch(html, /Updated/)
  assert.doesNotMatch(html, new RegExp(fmt(scraped).replaceAll('/', '\\/')))
  assert.match(html, /Procurement with no parsed notice date/)
})
