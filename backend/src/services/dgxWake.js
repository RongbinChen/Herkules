// Tell the DGX there is work waiting.
//
// The DGX sits behind a Mihomo TUN with no public address, so the VPS cannot
// dial it. What it CAN dial is 127.0.0.1: the DGX holds an SSH reverse tunnel
// open (`ssh -N -R`), which publishes a local port here that lands on the DGX.
// From this file's point of view that is an ordinary localhost request; the
// direction of the underlying TCP connection is the tunnel's business.
//
// THIS IS A LATENCY OPTIMISATION, NOT A DELIVERY MECHANISM. The queue in the
// database is what makes a file get read. A wake that fails — tunnel down, DGX
// asleep, machine rebooting — is logged and forgotten, because the row is still
// PENDING and the worker drains the queue when it comes back. Treating the poke
// as the handoff would mean every upload during a DGX outage silently never
// gets read, which is the failure the queue exists to prevent.
const WAKE_URL = process.env.DGX_WAKE_URL || 'http://127.0.0.1:9099/wake';
const TIMEOUT_MS = 2000;

export async function wakeDgx(reason = 'upload') {
  // Unset means "no tunnel in this environment" (local dev, or before the DGX
  // side is set up). Silent no-op rather than a warning per upload.
  if (process.env.DGX_WAKE_URL === '') return false;
  try {
    const res = await fetch(WAKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, at: new Date().toISOString() }),
      // Short: the upload response must not wait on a machine that may be off.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[dgx] wake returned ${res.status} — queue will be drained on reconnect`);
      return false;
    }
    return true;
  } catch (err) {
    // Expected whenever the DGX is off. Not an error condition for the upload.
    console.log(`[dgx] wake unreachable (${err.name}) — queue will be drained on reconnect`);
    return false;
  }
}
