// Geocoding via DeepSeek chat API. The model is given an address and asked to
// return JSON coordinates. Never throws — geocoding must not block saving a customer.
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

export async function geocodeAddress(address) {
  if (!address || !address.trim()) return null;

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[geocode] DEEPSEEK_API_KEY not set — skipping geocode');
    return null;
  }

  const prompt =
    'You are a geocoding assistant. Given the address below, respond with ONLY a JSON object ' +
    'containing the WGS-84 latitude and longitude. No markdown, no explanation.\n' +
    'Example response: {"latitude":30.5928,"longitude":114.3055}\n\n' +
    `Address: ${address.trim()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 60,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[geocode] DeepSeek API error:', res.status, body);
      return null;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    // Extract the first {...} block from the response
    const match = text.match(/\{[^}]+\}/);
    if (!match) return null;

    const coords = JSON.parse(match[0]);
    const latitude = Number(coords.latitude);
    const longitude = Number(coords.longitude);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

    return { latitude, longitude };
  } catch (err) {
    console.error('[geocode] failed:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
