/*
 * WHAT: the fidelity bench's logic.
 *
 * WHY a separate file rather than an inline <script> in harness.html: extension pages run
 * under a Content Security Policy that forbids inline scripts. An inline block does not
 * error visibly -- it simply never runs, so the button appears dead and the page looks
 * broken for no stated reason. Same trap as popup.js.
 */

import { captureDomain, remove, restore, diff } from "../src/cookies.js";

const out = document.getElementById("out");
const write = (html) => { out.innerHTML += html; };

document.getElementById("run").addEventListener("click", async () => {
  const domain = document.getElementById("domain").value.trim().replace(/^\./, "");
  out.innerHTML = "";
  if (!domain) { write(`<p class="ko">Enter a domain.</p>`); return; }

  try {
    // 1. Capture. Keep a deep copy: the objects returned by the API could in principle be
    //    reused, and we want a frozen point of comparison.
    const before = structuredClone(await captureDomain(domain));
    write(`<p><strong>${before.length}</strong> cookie(s) captured on <code>${domain}</code>.</p>`);
    if (before.length === 0) {
      write(`<p class="ko">Nothing to test — log into the site in a tab first.</p>`);
      return;
    }

    // 2. Removal. This is the destructive step: if the restore below fails, the session for
    //    the domain under test is gone. Hence the warning at the top of harness.html.
    const r = await remove(before);
    write(`<p>Removed: <strong>${r.removed}</strong> / ${before.length}` +
          (r.failures.length ? ` — <span class="ko">${r.failures.length} failure(s)</span>` : ``) + `</p>`);

    // 3. Restore from the capture.
    const s = await restore(before);
    write(`<p>Restored: <strong>${s.restored}</strong> / ${before.length}` +
          (s.failures.length ? ` — <span class="ko">${s.failures.length} failure(s)</span>` : ``) + `</p>`);
    if (s.failures.length) {
      write(`<pre>${s.failures.map(f => `${f.name} @ ${f.domain}: ${f.reason}`).join("\n")}</pre>`);
    }

    // 4. Compare against what the browser actually holds, rather than trusting the counters
    //    above. A set() that returns without error may still have written something other
    //    than what it was asked for.
    const after = await captureDomain(domain);
    const deltas = diff(before, after);

    if (deltas.length === 0) {
      write(`<h2 class="ok">No deltas — restore is faithful on this domain.</h2>`);
    } else {
      write(`<h2 class="ko">${deltas.length} delta(s)</h2>
        <table><tr><th>Cookie</th><th>Field</th><th>Before → after</th></tr>` +
        deltas.map(d => `<tr><td><code>${d.name}</code></td><td>${d.field}</td><td>${d.note}</td></tr>`).join("") +
        `</table>`);
    }
  } catch (e) {
    // A bench that fails in silence is worse than no bench: surface the error on the page,
    // not only in a console nobody has open.
    write(`<h2 class="ko">Bench error</h2><pre>${e && e.stack ? e.stack : String(e)}</pre>`);
  }
});
