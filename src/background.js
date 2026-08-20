/*
 * WHAT: background entry point. Deliberately inert for now.
 *
 * WHY it already exists while doing nothing: the manifest has to load for the fidelity
 * bench to be reachable in the browser. That bench is the project's entry condition —
 * until it reports zero deltas, wiring up encryption, TTL and auto-injection would mean
 * building on an assumption.
 *
 * HOW the rest will fit together, once fidelity is proven:
 *   - crypto.js    PBKDF2 derivation + AES-GCM; the key never leaves this module
 *   - store.js     read/write the encrypted blob in storage.local
 *   - this file    the state machine: locked -> unlocked -> expired, the TTL alarms,
 *                  and the webNavigation listener that injects at the right moment.
 *
 * The invariant never to break: the derived key lives in a variable of this process and
 * nowhere else. Not storage.local, not sessionStorage, not a file. Write it anywhere and
 * the vault is worthless against the threat it targets — a program executing inside the
 * user's own session.
 */

// Check the required APIs at load time rather than at use time: a permission missing from
// the manifest would otherwise surface as a silent failure on the first lock, which is to
// say at the worst possible moment.
const required = ["cookies", "storage", "alarms"];
const missing = required.filter((api) => !browser[api]);

if (missing.length) {
  console.error("[lethoryale] unavailable APIs:", missing.join(", "));
} else {
  console.info("[lethoryale] background loaded — vault not wired up, fidelity bench available");
}
