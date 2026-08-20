/*
 * WHAT: wiring for the popup.
 *
 * WHY a separate file: extension pages run under a CSP that forbids inline scripts, so an
 * onclick attribute would silently do nothing -- exactly the kind of failure that makes you
 * think the extension is broken when it is merely muzzled.
 *
 * HOW: runtime.getURL() resolves the bench against the extension's own origin, whatever ID
 * the browser assigned it. Temporary add-ons get a fresh ID on every reload, so hardcoding
 * a moz-extension:// URL would break after the first reload.
 */

// Ping the background page. If it answers, the extension is loaded and its APIs are
// reachable -- which is the question anyone actually has when nothing seems to happen.
browser.runtime.getBackgroundPage()
  .then((bg) => {
    const el = document.getElementById("state");
    el.textContent = bg ? "loaded" : "unreachable";
    el.className = bg ? "ok" : "muted";
  })
  .catch(() => {
    const el = document.getElementById("state");
    el.textContent = "unreachable";
  });

document.getElementById("bench").addEventListener("click", () => {
  browser.tabs.create({ url: browser.runtime.getURL("test/harness.html") });
  window.close();
});
