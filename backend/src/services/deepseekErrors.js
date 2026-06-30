// Classify a DeepSeek API failure into a clear, user-facing message so the UI
// can tell the operator *why* an AI feature is unavailable (most importantly:
// the account is out of balance / overdue) instead of a generic failure.

export class DeepSeekError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DeepSeekError';
    this.status = status;
    this.isDeepSeek = true;
  }
}

// HTTP status + response body → human message.
export function deepseekFailureMessage(status, bodyText = '') {
  const t = (bodyText || '').toLowerCase();
  if (status === 402 || t.includes('insufficient balance')) {
    return 'AI service unavailable: DeepSeek account balance is insufficient (possibly overdue). Please top up the account and try again. (DeepSeek 账户余额不足，请充值后重试)';
  }
  if (status === 401 || t.includes('authentication') || t.includes('invalid api key') || t.includes('no api key')) {
    return 'AI service unavailable: DeepSeek API key is invalid or not configured. (DeepSeek API Key 无效或未配置)';
  }
  if (status === 429 || t.includes('rate limit')) {
    return 'AI service busy: DeepSeek rate limit reached. Please try again shortly. (DeepSeek 调用频率超限，请稍后重试)';
  }
  return `AI service temporarily unavailable (DeepSeek HTTP ${status || '?'}). Please try again later. (DeepSeek 服务暂不可用)`;
}

// Build a DeepSeekError from a failed fetch Response (already known !ok).
export async function deepseekErrorFromResponse(res) {
  const body = await res.text().catch(() => '');
  return new DeepSeekError(deepseekFailureMessage(res.status, body), res.status);
}

// Network/timeout failures (fetch threw) → unavailable message.
export function deepseekNetworkError(err) {
  const aborted = err?.name === 'AbortError';
  return new DeepSeekError(
    aborted
      ? 'AI service timed out: DeepSeek did not respond in time. Please try again. (DeepSeek 响应超时)'
      : 'AI service temporarily unavailable: cannot reach DeepSeek. Please try again later. (无法连接 DeepSeek)',
  );
}
