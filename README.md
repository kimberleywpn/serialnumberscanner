# Label Lens — logged-in serial scanner

The mobile frontend is hosted at
https://kimberleywpn.github.io/serialnumberscanner/. Its authenticated API is
running at https://m9kw6gfq-8088.asse.devtunnels.ms. This matches the battery-app
deployment pattern: GitHub Pages serves only public browser files, while shared
login, SQLite and the private product catalogue stay on the PC. Real account
sign-in and physical phone-camera testing remain pending. See RUNNING.md for the
current local setup; the PC, scanner process and tunnel must stay running.

## Staff workflow

1. Sign in with the existing shared battery / sales dashboard username and password.
2. Pick Kroon-Oil or WIN and a product variant. Oil type, SAE grade and API/ACEA/JASO/ILSAC ratings come from the private catalogue.
3. Pick any of 1L, 3.5L, 4L, 5L or 18L for every product. Type dealer name and batch.
4. Scan QR / printed text, or enter a serial manually. Review and correct it, then add it to the draft.
5. Submit the confirmed draft. Each submission records the product snapshot, litres, dealer, batch, serials, account and UTC timestamp.
6. Users see their own submitted history. Admins can switch to the master view and search everyone's submissions. Both views have copyable serial lists and pagination.

Details are locked once the first draft serial is added, preventing a batch from
accidentally changing product halfway through. Submit or clear the draft to change
them. Dealer and batch stay selected after a successful submission for another list.
Drafts stay in memory, not shared localStorage. Submit before leaving/signing out.
Saved history cannot be deleted through the web interface. Clearing a draft never
deletes submitted records.

## Authentication and storage

- Central account source: PostgreSQL `public.sales_report_login`, SELECT-only connection, existing bcrypt hashes. The scanner never creates/changes central accounts, shares another app's session token, or copies passwords/password hashes into SQLite.
- Scanner-specific data: `data/label-lens.sqlite` in WAL mode. Not the battery or dashboard SQLite file.
- Default admin roles: `admin`, `logistic`, consistent with the existing shared-login integration. `manager` and `sales` submit and see their own history. `account`, `readonly`, `warehouse`, `warehouse_preview`, `warehouse preview` are read-only and cannot submit or open master history. Unknown roles are refused. Configure `LABEL_LENS_ADMIN_ROLES` only when the account owner approves a role policy change.
- Separate opaque 12-hour bearer session for the GitHub frontend, stored only in that site's browser storage. The API stores only token hashes. CSRF tokens, an exact GitHub Pages origin allowlist and strict CORS protect writes. Same-origin direct-server access retains the secure cookie fallback.
- Central password/role changes and removed accounts invalidate scanner access on the next API request. If PostgreSQL is unavailable, requests fail closed; no offline-login fallback.
- Login throttling persists across service restarts. Configure the HTTPS proxy to supply the actual client address; forwarded headers are trusted only from loopback.
- Serials are unique across all submissions. A duplicate aborts the entire new submission without saving part of it. Conflicts do not disclose another user's details. Remove already-submitted serials from the draft and retry.
- Retry IDs make network retries idempotent. Submission owner and product metadata are assigned by the server, not accepted from arbitrary client fields.
- Camera images, photos and raw QR URLs are not uploaded. Tesseract downloads its OCR runtime/language files from its normal CDN endpoints; processing occurs on the device. Internet access is needed for OCR initialization.

## QR limitations

TAA/TBA/THA are supported when read as printed text or directly from plain QR data;
manual confirmation accepts three letters followed by 7–10 digits.
Opaque SIRIM links still use the earlier **sample-only TAA8 estimate**. Product
selection never changes a QR-derived prefix. Check the complete printed serial,
including its prefix, before confirming. QR estimates are flagged in stored history
and are not SIRIM authenticity checks. Physical phone-camera accuracy still needs
testing on the staff phone after HTTPS deployment.

## Private catalogue

`catalogue.json` contains 47 source rows imported read-only from the supplied SKU
workbook (35 KROON-OIL, 12 WIN). IDs and source sheet/row references are retained.
Source wording/ratings have not been silently corrected. Keep IDs stable when
updating this file. Restarting seeds the current product master; historical
submissions retain their original metadata snapshot.

The catalogue is outside `public/` and served only through the authenticated API.
It is intentionally gitignored. Deliver it privately to the server operator.
Never commit `.env`, database files, backups, catalogue or the original workbook
to a public GitHub repository.

## Deployment alongside the battery backend

The current battery frontend embeds an HTTPS dev-tunnel endpoint on port **8080**.
Leave that application, its port and its tunnel alone. The scanner is a separate
service on loopback **8088**, with its own HTTPS forwarded address. No changes to
the battery or sales dashboard code/database are required.

1. Keep this folder on the same PC/server that can reach the shared login database.
2. Create a separate virtual environment and install the pinned dependencies:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

3. Forward `127.0.0.1:8088` using the existing deployment system (for example, the
   VS Code Ports/Dev Tunnels setup) or a dedicated HTTPS reverse proxy. Obtain the
   actual scanner HTTPS origin first. Do not guess an address or expose a test-only
   QA service. A normal proxy should preserve the original Host header. For a
   Microsoft dev tunnel rewriting Host/Origin to localhost, explicitly set
   `LABEL_LENS_TUNNEL_PORT=8088`. This permits only the local forwarded hostname
   and exact local origins, with same-origin fetch metadata plus the scanner's
   custom origin header. CORS is restricted to the configured GitHub Pages origin,
   and session writes still require CSRF.
   This compatibility setting is refused for non-devtunnels.ms public origins.
4. Create private `.env` from `.env.example`. Set `LABEL_LENS_ORIGIN` to that exact
   HTTPS API origin and `LABEL_LENS_FRONTEND_ORIGIN` to
   `https://kimberleywpn.github.io`, both without a trailing slash or path. Set
   `SHARED_AUTH_ENV_FILE` to the existing private auth configuration file. Do not
   paste credentials into HTML, browser settings, URL query parameters, or GitHub
   variables.
5. Run `./Start-Server.ps1`. Keep it running. For an unattended server, register
   this command through the server operator's existing service/scheduler mechanism.
   Do not stop or replace the existing apps.
6. Publish only the files inside `public/` to GitHub Pages, and open the GitHub Pages
   URL on staff phones. `account.js` points API requests at the HTTPS tunnel and
   sends the scanner's separate bearer token. Never publish `.env`, `catalogue.json`,
   SQLite files, backups or the source workbook.
7. Verify real login, product selection, physical camera, confirmation, submission,
   personal history, master history, and logout on a phone before release.

An operator using Caddy can add a **new** dedicated site, leaving existing site
blocks unchanged:

```caddyfile
scanner.example.com {
    reverse_proxy 127.0.0.1:8088
}
```

Replace the example with an owned, configured domain; do not use it literally.
See [Caddy reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
No wildcard CORS is enabled; only the configured GitHub Pages origin is accepted.

## Backups and tests

Run `./.venv/Scripts/python.exe -m server.backup` for a consistent, verified private
SQLite snapshot (including WAL data). Store backups outside the public directory,
protect them like the live database, and copy them to private off-server storage.
Before a restore, stop only this scanner service, retain the current database and
its WAL/SHM files recoverably, and have the operator restore/test the private
snapshot. Restoring may restore old scanner sessions; clear the `sessions` table
as part of the controlled restore before starting service.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-test.txt
.\.venv\Scripts\python.exe -m pytest tests -q
```

Test authentication is injected only by test fixtures. The production factory has
no demo accounts or environment variable that bypasses shared authentication.

