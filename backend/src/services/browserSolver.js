// Headless-browser session solver for chinabidding.com.
//
// The site sits behind a 知道创宇/云盾 anti-bot that serves a JavaScript
// challenge (HTTP 521) to plain HTTP clients. The resulting `https_ydclearance`
// cookie is bound to BOTH the solving IP and the User-Agent, so cookies from a
// developer's laptop don't work on the server. We therefore solve the challenge
// (and log in) with a real headless Chromium ON THE SERVER, export the cookies,
// close the browser, and let the lightweight fetch scraper reuse them.
import { chromium } from 'playwright';

const BASE_URL = process.env.CHINABIDDING_BASE_URL || 'https://www.chinabidding.com/en';
const LOGIN_URL = `${BASE_URL}/login/loginEn.htm`;
const USERNAME = process.env.CHINABIDDING_USERNAME;
const PASSWORD = process.env.CHINABIDDING_PASSWORD;

// Fixed UA — the fetch scraper MUST send this exact value, since the anti-bot
// clearance cookie is bound to the User-Agent that solved the challenge.
export const SCRAPER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// Launch headless Chromium, clear the anti-bot challenge and log in, then return
// { cookies, userAgent } where `cookies` is a Cookie-header string for fetch.
// Throws on missing credentials, launch failure, or an uncleared challenge.
export async function solveSession() {
  if (!USERNAME || !PASSWORD) throw new Error('Chinabidding credentials not configured.');
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const ctx = await browser.newContext({ userAgent: SCRAPER_UA, locale: 'en-US' });
    const page = await ctx.newPage();

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000); // let the anti-bot challenge execute

    await page.fill('#username', USERNAME);
    await page.fill('#userpass', PASSWORD);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}),
      page.click('#login-button'),
    ]);
    await page.waitForTimeout(4000); // settle post-login redirects

    const cookies = await ctx.cookies();
    const cookieHeader = cookies
      .filter((c) => c.domain.includes('chinabidding.com'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    if (!/ydclearance/i.test(cookieHeader)) {
      throw new Error('anti-bot challenge not cleared (no ydclearance cookie)');
    }
    return { cookies: cookieHeader, userAgent: SCRAPER_UA };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
