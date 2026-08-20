/*
 * WHAT: faithful capture and restore of a domain's cookies.
 *
 * WHY: this is the only place where the project can fail technically. Everything else
 * (encrypting a blob, running a TTL) is mechanical work. Here, lose a single attribute
 * on the way back — httpOnly, sameSite, partitionKey — and the server invalidates the
 * session, leaving the user logged out with no idea why. A vault that hands back damaged
 * cookies is worse than no vault at all: it breaks the very thing it claims to protect.
 * Hence a module kept separate and testable on its own.
 *
 * HOW: the WebExtension API is not symmetric. cookies.getAll() returns Cookie objects,
 * cookies.set() expects CookieDetails — fields differ in name, and some must be derived
 * rather than copied. The four traps handled here:
 *
 *   1. `domain` vs `url`. set() requires a `url` that get() never provides. We rebuild it
 *      from domain + path + secure, stripping the leading dot of generic domains
 *      (".example.com" -> "example.com"), which would otherwise produce an invalid URL.
 *   2. `hostOnly`. A host-only cookie must NOT be given a `domain` in set(): passing one
 *      would turn a host cookie into a domain cookie, widening its scope. We omit the
 *      field and let the API derive it from the url.
 *   3. `session` vs `expirationDate`. Session cookies carry no date. Setting one would
 *      make them persistent — the exact opposite of what this project is for.
 *   4. `partitionKey` (CHIPS) and `storeId` (containers). Two cookies with the same name
 *      and domain coexist when these differ. Ignoring them would make sessions from
 *      different containers overwrite each other.
 */

/**
 * Captures every cookie for a domain, across all cookie stores.
 *
 * WHY every store: Firefox containers (and therefore Zen) isolate cookies by storeId.
 * Querying only the default store would miss sessions opened in a container tab, and the
 * lock step would leave those cookies sitting in the clear.
 *
 * @param {string} domain domain to capture, no leading dot (e.g. "example.com")
 * @returns {Promise<Array>} raw cookies as returned by the API
 */
export async function captureDomain(domain) {
  const stores = await browser.cookies.getAllCookieStores();
  const batches = await Promise.all(
    stores.map((s) => browser.cookies.getAll({ domain, storeId: s.id }))
  );
  return batches.flat();
}

/**
 * Rebuilds the URL required by cookies.set() and cookies.remove().
 *
 * HOW: the scheme comes from `secure` (a Secure cookie can only be set over https). The
 * leading dot of a generic domain is stripped: ".example.com" is not a valid host inside a
 * URL, even though it is a perfectly legal cookie domain value.
 */
function cookieUrl(cookie) {
  const host = cookie.domain.replace(/^\./, "");
  const scheme = cookie.secure ? "https" : "http";
  return `${scheme}://${host}${cookie.path}`;
}

/**
 * Translates a Cookie object (read shape) into CookieDetails (write shape).
 *
 * WHY a separate function: this mapping table carries all of the module's risk. Isolating
 * it makes it testable without a browser, and makes it obvious at a glance which fields are
 * copied, derived, or deliberately left out.
 */
export function toDetails(cookie) {
  const details = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    storeId: cookie.storeId,
  };

  // Trap 2: on a host-only cookie, setting `domain` would widen its scope to every
  // subdomain. Leave it out and let the API derive it from the url.
  if (!cookie.hostOnly) details.domain = cookie.domain;

  // Trap 3: a session cookie dies with the browser; it has no expiry date.
  if (!cookie.session) details.expirationDate = cookie.expirationDate;

  // Trap 4: CHIPS. Absent on browsers that don't implement it, hence the guard.
  if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;

  return details;
}

/**
 * Reinjects a list of captured cookies.
 *
 * WHY we don't stop at the first failure: a session often spans ten to twenty cookies, and
 * a single rejection (one expired in the meantime, a malformed __Host- prefix) must not
 * prevent the rest from coming back. We collect failures and hand them to the caller, who
 * decides whether they're benign — a silent vault would let you believe the restore was
 * complete.
 *
 * @returns {Promise<{restored: number, failures: Array<{name: string, reason: string}>}>}
 */
export async function restore(cookies) {
  const failures = [];
  let restored = 0;

  for (const c of cookies) {
    try {
      await browser.cookies.set(toDetails(c));
      restored++;
    } catch (e) {
      failures.push({ name: c.name, domain: c.domain, reason: String(e.message || e) });
    }
  }
  return { restored, failures };
}

/**
 * Removes the given cookies from the browser.
 *
 * WHY we delete exactly the captured list rather than "the whole domain": between capture
 * and removal the site may have set a fresh cookie. Deleting blindly would wipe data we
 * never put in the vault — and therefore lose it.
 */
export async function remove(cookies) {
  const failures = [];
  let removed = 0;

  for (const c of cookies) {
    try {
      const res = await browser.cookies.remove({
        url: cookieUrl(c),
        name: c.name,
        storeId: c.storeId,
        ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}),
      });
      // remove() returns null when it found nothing: not an exception, but not a removal
      // either. Count it as a failure — otherwise the vault would believe it is empty
      // while a cookie is still sitting there in the clear.
      if (res) removed++;
      else failures.push({ name: c.name, domain: c.domain, reason: "not found" });
    } catch (e) {
      failures.push({ name: c.name, domain: c.domain, reason: String(e.message || e) });
    }
  }
  return { removed, failures };
}

/**
 * Compares two captures and lists differences field by field.
 *
 * WHY: this is the project's evidence tool. It lets us claim "restore is faithful" on the
 * strength of a measurement rather than a code read. Used by the test protocol before any
 * real domain is allowed into the configuration.
 *
 * Values are compared but never reported: a diagnostic must not spill a session token into
 * a console.
 */
export function diff(before, after) {
  const fields = ["value", "domain", "path", "secure", "httpOnly", "sameSite",
                  "session", "expirationDate", "hostOnly", "storeId"];
  const key = (c) => `${c.storeId}|${c.domain}|${c.path}|${c.name}`;
  const index = new Map(after.map((c) => [key(c), c]));
  const deltas = [];

  for (const a of before) {
    const b = index.get(key(a));
    if (!b) { deltas.push({ name: a.name, field: "(missing)", note: "not restored" }); continue; }
    for (const f of fields) {
      if (a[f] !== b[f]) {
        deltas.push({
          name: a.name,
          field: f,
          // Never disclose the value: only its length can reveal a truncation.
          note: f === "value" ? `length ${a[f]?.length} -> ${b[f]?.length}` : `${a[f]} -> ${b[f]}`,
        });
      }
    }
    index.delete(key(a));
  }
  for (const [, c] of index) deltas.push({ name: c.name, field: "(extra)", note: "present after, absent before" });

  return deltas;
}
