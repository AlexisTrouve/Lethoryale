# Lethoryale

A Firefox extension that keeps cookies for a few sensitive domains **encrypted while you're not
using them**. The decryption key lives in memory, never on disk.

> **Status: prototype.** Cookie restore is implemented and testable; encryption is not wired up
> yet. See [Roadmap](#roadmap).

---

## The problem

An infostealer running in your session reads `cookies.sqlite` and walks away with your logins.
It needs neither your password nor your second factor: a session cookie *is* the session.

The usual defences don't cover this case.

| Defence | What it actually does |
|---|---|
| Full-disk encryption | Protects a **powered-off** disk. While the machine runs, files are readable. |
| Per-file encryption (EFS…) | The OS decrypts transparently for your account — therefore also for malware running as your account. |
| Browser primary password | Covers `logins.json`. **Not cookies.** |
| Clear cookies on shutdown | Useless if the browser never shuts down. |

Firefox doesn't implement [DBSC](https://github.com/w3c/webappsec-dbsc), which binds a session to
a non-exportable TPM key. Until it does, the only lever left is to **shrink the window during
which there is something worth stealing**.

## What Lethoryale does

For a list of domains you choose — and only those:

1. **Lock** — after a period with no activity on those domains, their cookies are encrypted
   (AES-GCM, key derived from your passphrase via PBKDF2) and **removed from the browser**.
2. **Unlock** — you type your passphrase, the cookies are reinjected exactly as they were.
3. **In between** — `cookies.sqlite` holds nothing but an unusable blob.

Every other site is untouched. No passphrase to read your mail.

## What Lethoryale does not do

Read this before installing it.

- **It does not protect you while you're using it.** Once unlocked, cookies are in the clear,
  exactly as before. The gain is temporal: "stealable at all times" becomes "stealable during
  the minutes I'm actually there".
- **It does not stop a patient attacker.** Anyone who can read your cookies can also log your
  keystrokes and wait for the unlock.
- **It does not replace the browser's cookie store.** It only removes entries from it and puts
  them back.
- **It does not help with already-stolen sessions.** Deleting a cookie invalidates nothing
  server-side; only signing out at the provider does.

In short: Lethoryale targets opportunistic theft, not a determined adversary with a foothold. If
someone has been living in your machine for three weeks, this will not save you.

## Design decisions

**Manifest V2, persistent background.** Under MV3 the background is unloaded when idle — and its
memory is precisely what holds the key. Unloading would drop it at an unpredictable moment and
prompt for the passphrase for no visible reason. This is a security-model decision, not
technical debt.

**The key never leaves the background process's memory.** Not `storage.local`, not
`sessionStorage`, not a file. That's the project's invariant: write it anywhere and the whole
point evaporates.

**Restore fidelity before anything else.** A vault that hands back damaged cookies breaks the
very thing it claims to protect. `src/cookies.js` handles the four traps in the API: `hostOnly`
(setting `domain` would widen the cookie's scope), session cookies carrying no expiry,
`partitionKey` (CHIPS) and `storeId` (containers).

## Try it

```
about:debugging → This Firefox → Load Temporary Add-on → manifest.json
then open moz-extension://<id>/test/harness.html
```

The harness runs a full round trip — capture, remove, restore, field-by-field comparison — and
only passes when the diff table is empty.

⚠️ **Test on a domain you don't care about.** The harness really does delete the cookies before
putting them back.

## Roadmap

- [x] `cookies.js` — faithful capture and restore
- [x] Fidelity harness
- [ ] `crypto.js` — PBKDF2 + AES-GCM
- [ ] Encrypted vault in `storage.local`
- [ ] State machine: locked / unlocked / expired, sliding TTL
- [ ] Auto-inject on navigation to a protected domain
- [ ] Domain configuration UI
- [ ] Mozilla signing for self-distribution

## Licence

MIT — see [LICENSE](LICENSE).
