# Chinabidding Module Project Plan

## 1. Background

Current public entry:

- Production page: `https://www.herkulesgroup-china.com/chinabidding`
- Source website: `https://www.chinabidding.com/en/info/search.htm`

The current module already has a first version:

- Backend routes under `/api/chinabidding`
- Project list scraping from Chinabidding
- Keyword search
- Basic project table
- Basic statistics by project type, status, and region

The module is not yet complete. The next version should become an internal tender intelligence tool that can collect new tender information, competitor-related tender information, and summarize the collected data for sales and management review.

## 2. Product Goals

1. Scrape new project information from Chinabidding reliably.
2. Scrape competitor-related information by configured keywords.
3. Store structured tender/project data in the database.
4. Track each scrape job with status, timing, success count, failure count, and error logs.
5. Provide filtering, search, detail view, and statistics in the web module.
6. Keep Chinabidding login credentials in deployment configuration, not hardcoded in source code.
7. Make the system maintainable when Chinabidding page structure or login flow changes.

## 3. User Roles

- Sales team: search and inspect new tender opportunities.
- Management: review market activity, competitor activity, and weekly/monthly summaries.
- Admin/maintainer: configure keywords, regions, industries, competitor names, and scraping schedule.

## 4. Existing Code Baseline

Backend:

- `backend/src/routes/chinabidding.js`
- `backend/src/services/chinabidding.js`
- `backend/prisma/schema.prisma`

Frontend:

- `frontend/src/components/BidProjectList.jsx`
- `frontend/src/components/BidStatistics.jsx`
- `frontend/src/api/chinabidding.js`
- Route: `/chinabidding`
- Route: `/chinabidding/stats`

Current database model:

- `BidProject`
- `BidStatus`
- `BidType`

Important technical issue:

- Chinabidding login credentials are currently hardcoded in `backend/src/services/chinabidding.js`.
- First implementation task should move them to environment variables, for example:
  - `CHINABIDDING_USERNAME`
  - `CHINABIDDING_PASSWORD`
  - `CHINABIDDING_BASE_URL`
  - `CHINABIDDING_CAS_LOGIN_URL`

## 5. Functional Scope

### 5.1 Project Scraping

Collect project information from Chinabidding search/list/detail pages.

Supported tender categories:

- New tenders
- Tender changes
- Evaluation results
- Tender awards
- Past/closed tenders

Recommended normalized type enum:

- `NEW_TENDER`
- `TENDER_CHANGE`
- `EVALUATION_RESULT`
- `TENDER_AWARD`
- `PAST_TENDER`

Fields to extract:

- Project name
- Project code / bidding number
- Tender type
- Industry
- Region / province / city
- Purchaser
- Bidding agency
- Source of funds
- Publish date
- Bid open date
- Submission deadline
- Evaluation result date
- Award date
- Winning bidder
- Winning amount
- Currency
- Budget or document price
- Keywords matched
- Competitors matched
- Source URL
- Raw HTML / raw text snapshot
- Last scraped time

### 5.2 Competitor Monitoring

Maintain a configurable competitor list.

Initial competitor keywords can include:

- `georg`
- `pomini`
- `INNSE`
- `DANIELI`
- `SMS`
- `VAI`

Capabilities:

- Search Chinabidding by competitor keyword.
- Store competitor matches with project relation.
- Detect whether the competitor appears in:
  - Project title
  - Project content
  - Purchaser field
  - Bidding agency field
  - Winning bidder field
- Show competitor activity trends by month, tender type, industry, and region.

### 5.3 Config Management

Configuration should support:

- Chinabidding username/password
- Default scrape interval
- Max pages per scrape
- Request delay and retry count
- Competitor keywords
- Product keywords
- Region filters
- Industry filters
- Notification thresholds

Implementation recommendation:

- Sensitive values in environment variables.
- Business configuration in database tables.
- Optional admin UI for non-sensitive configuration.

### 5.4 Statistics And Summaries

Statistics page should include:

- Total projects
- New projects this week/month
- Tender awards this week/month
- Top regions
- Top industries
- Top purchasers
- Top bidding agencies
- Competitor mentions
- Competitor wins
- Keyword trends
- Projects by tender stage
- Deadline calendar / upcoming deadlines

Summary output:

- Weekly summary
- Monthly summary
- Competitor summary
- New opportunity summary

Each summary should answer:

- What changed recently?
- Which projects look relevant to Herkules?
- Which competitors appeared?
- Which tender awards are important?
- Which deadlines need attention?

## 6. Proposed Data Model

Extend the Prisma schema with the following concepts.

### 6.1 BidProject

Extend current model:

- `tenderType`
- `projectCode`
- `projectName`
- `industry`
- `region`
- `province`
- `city`
- `purchaser`
- `biddingAgency`
- `sourceOfFunds`
- `publishDate`
- `deadline`
- `bidOpenDate`
- `awardDate`
- `winningBidder`
- `winningAmount`
- `currency`
- `budget`
- `status`
- `sourceUrl`
- `sourceSite`
- `rawContent`
- `contentText`
- `contentHash`
- `lastScrapedAt`

### 6.2 BidCompetitor

Stores configured competitor names and aliases.

- `id`
- `name`
- `aliases`
- `isActive`
- `createdAt`
- `updatedAt`

### 6.3 BidProjectCompetitorMatch

Stores competitor-project matches.

- `id`
- `projectId`
- `competitorId`
- `matchedAlias`
- `matchedField`
- `confidence`
- `createdAt`

### 6.4 BidScrapeJob

Tracks scraping runs.

- `id`
- `jobType`
- `status`
- `startedAt`
- `finishedAt`
- `requestedByUserId`
- `keyword`
- `tenderType`
- `pagesRequested`
- `pagesScraped`
- `itemsFound`
- `itemsCreated`
- `itemsUpdated`
- `itemsFailed`
- `errorMessage`

### 6.5 BidScrapeLog

Stores detailed logs per job.

- `id`
- `jobId`
- `level`
- `message`
- `url`
- `createdAt`

### 6.6 BidConfig

Stores non-sensitive business configuration.

- `id`
- `key`
- `value`
- `description`
- `updatedByUserId`
- `updatedAt`

## 7. Backend Architecture

Recommended service split:

- `chinabiddingClient.js`
  - Login
  - Cookie/session handling
  - Authenticated fetch
  - Retry and throttling
- `chinabiddingParser.js`
  - Parse list pages
  - Parse detail pages
  - Normalize dates and fields
- `chinabiddingScraper.js`
  - Orchestrate scraping jobs
  - Handle pagination
  - Store job logs
- `bidProjectRepository.js`
  - Upsert project records
  - Search/filter queries
- `competitorMatcher.js`
  - Match competitor aliases against parsed project fields
- `bidStatistics.js`
  - Dashboard statistics and summaries

Recommended API endpoints:

- `GET /api/chinabidding/projects`
- `GET /api/chinabidding/projects/:id`
- `POST /api/chinabidding/scrape`
- `GET /api/chinabidding/scrape-jobs`
- `GET /api/chinabidding/scrape-jobs/:id`
- `GET /api/chinabidding/statistics`
- `GET /api/chinabidding/competitors`
- `POST /api/chinabidding/competitors`
- `PUT /api/chinabidding/competitors/:id`
- `DELETE /api/chinabidding/competitors/:id`
- `GET /api/chinabidding/config`
- `PUT /api/chinabidding/config`

## 8. Frontend Pages

### 8.1 Project List

Improve current `/chinabidding` page:

- Filters:
  - Tender type
  - Status
  - Region
  - Industry
  - Purchaser
  - Bidding agency
  - Publish date range
  - Deadline range
  - Competitor
  - Keyword
- Table columns:
  - Project name
  - Tender type
  - Region
  - Purchaser
  - Bidding agency
  - Publish date
  - Deadline
  - Competitor matches
  - Status
- Actions:
  - Open detail
  - Open source URL
  - Trigger scrape
  - Export CSV

### 8.2 Project Detail

New detail view:

- Structured fields
- Source URL
- Raw text preview
- Competitor matches
- Related projects by purchaser/agency/competitor
- Scrape history

### 8.3 Statistics Dashboard

Improve `/chinabidding/stats`:

- KPI cards
- Region ranking
- Industry ranking
- Competitor trend
- Tender type breakdown
- Recent awards
- Upcoming deadlines

### 8.4 Configuration Page

Admin-only page:

- Competitor keyword management
- Product keyword management
- Scrape schedule
- Max pages / retry / delay settings
- Display current Chinabidding credential status without showing password

### 8.5 Scrape Jobs Page

Admin-only page:

- Job list
- Job status
- Counts
- Errors
- Job logs

## 9. Scraping Strategy

### 9.1 Login

- Use environment variables for credentials.
- Cache login cookies for the session.
- Re-login automatically if Chinabidding redirects to login page.
- Never log the password.

### 9.2 Search/List Pages

- Support GET/POST search form parameters.
- Support tender type filters.
- Support keyword search.
- Support pagination.
- Stop when:
  - Max pages reached
  - No new links found
  - Date is older than configured cutoff

### 9.3 Detail Pages

- Store raw HTML snapshot.
- Extract readable plain text.
- Parse structured fields using multiple fallback patterns.
- Deduplicate by project code first, then source URL, then content hash.

### 9.4 Rate Limiting And Reliability

- Add delay between requests.
- Add retry with backoff.
- Track failed URLs in job logs.
- Do not block the HTTP request for long-running full scrapes; create a job and process it asynchronously when possible.

## 10. Security Requirements

1. Move Chinabidding credentials out of source code.
2. Add `.env.example` without real secrets.
3. Ensure `.env` is not committed.
4. Restrict scrape/config endpoints to authenticated users.
5. Restrict config and manual scrape controls to admins if needed.
6. Do not expose raw credentials through API responses.
7. Avoid logging cookies, password, or full authentication responses.

## 11. Implementation Phases

### Phase 1: Stabilize Existing Module

Deliverables:

- Move credentials to environment variables.
- Add `.env.example`.
- Add missing auth middleware on Chinabidding routes if not already globally protected.
- Refactor scraper into client/parser/scraper modules.
- Add job status tracking table.
- Improve existing project upsert logic.
- Make manual scrape return job result or job ID.

Acceptance criteria:

- App works without hardcoded Chinabidding credentials.
- Manual scrape creates or updates records.
- Failed URLs are visible in logs.
- Existing `/chinabidding` list still works.

### Phase 2: Complete Project Data Collection

Deliverables:

- Parse all target tender types.
- Parse more structured fields from detail pages.
- Add pagination support.
- Add deduplication by project code/source URL/content hash.
- Add project detail API and page.

Acceptance criteria:

- New tenders, changes, results, and awards can be scraped.
- Project details show structured fields and source link.
- Duplicate source records do not create duplicate projects.

### Phase 3: Competitor Monitoring

Deliverables:

- Add competitor tables.
- Seed default competitor list.
- Add competitor matching service.
- Add competitor filters and statistics.
- Add competitor configuration UI.

Acceptance criteria:

- User can search and filter projects by competitor.
- Competitor mentions are stored separately from project data.
- Dashboard shows competitor activity trends.

### Phase 4: Summary And Analytics

Deliverables:

- Weekly/monthly summary APIs.
- Top purchaser/agency/region/industry rankings.
- Upcoming deadline report.
- Export CSV.

Acceptance criteria:

- Management can review a concise weekly/monthly view.
- Sales can export filtered project lists.
- Dashboard highlights relevant recent activity.

### Phase 5: Automation And Operations

Deliverables:

- Scheduled scrape jobs.
- Admin scrape job page.
- Retry failed job action.
- Basic monitoring logs.
- Optional notification integration later.

Acceptance criteria:

- System can scrape automatically on a configured schedule.
- Admin can inspect job status and failures.
- Manual scrape remains available.

## 12. Suggested First Development Tasks

1. Remove hardcoded Chinabidding username/password from `backend/src/services/chinabidding.js`.
2. Add `backend/.env.example`.
3. Add Prisma models for scrape jobs and competitor configuration.
4. Split current scraper into client, parser, scraper, and statistics modules.
5. Add a project detail route and frontend detail page.
6. Add competitor keyword matching for the existing predefined tags.
7. Improve statistics to include competitor counts and recent awards.

## 13. Open Questions

1. Should every normal user be allowed to trigger scraping, or only admins?
2. How often should automatic scraping run?
3. Which tender types are most important for Herkules in the first release?
4. Should summaries be generated only from stored data, or should they also trigger fresh scraping?
5. Should raw HTML be kept permanently, or only for a limited retention period?
6. Is the Chinabidding account shared, or should the app support multiple accounts in the future?

