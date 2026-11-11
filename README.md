# On-Call Log

A small iPhone-friendly web app for logging calls while on call and producing a PDF to send in to work.

- **Start on-call / End on-call** marks each on-call period.
- **Log a call** records the patient URN and initials, start time, minutes spent, remote vs went-in recall, and who called, on a single screen with one-tap buttons. A banner shows whether the call will be paid.
- **Create recall form (PDF)** fills in the Alfred Health *Recall Claim Form* (or the Monash Health *Recall Form (without return to Hospital)* — choose in My details) for an on-call period or a date range, and opens the iPhone share sheet so it can be emailed.
- **One paid call per hour:** a remote call is paid only if it starts at least 60 minutes after the previous paid call (19:15 paid, 20:14 not paid, 20:15 paid). By default only paid calls go on the form; My details has an option to include all calls.
- **Pay estimate:** pick a registrar year level and each on-call period shows estimated pay: remote recalls (paid calls x minimum 1 hour x overtime multiplier), physical recalls (minimum 3 hours; first 2 at 1.5x, then 2x) and the on-call allowance (2.5% of the weekly rate per on-call period, 3.5% on public holidays, one period per 12 hours unless edited). The hourly rate is the weekly rate / 43. Rates are in `app.js` (`WEEKLY`), from the AMA Victoria Doctors in Training Agreement 2022-2026 as at 1 March 2025.
- **Signature:** sign once in My details and it is placed on every form.
- Works offline once installed. All data stays on the phone; nothing is uploaded.

## Installing on an iPhone

1. Open the site in **Safari**.
2. Tap the **Share** button, then **Add to Home Screen**.
3. Open it from the Home Screen icon from then on.

Fill in **My details** once; those details are printed at the top of every PDF.

## Hosting

The app is plain static files (no build step). To publish with GitHub Pages:
repository **Settings → Pages → Deploy from a branch**, choose the branch and `/ (root)`.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and Home Screen install |
| `vendor/` | jsPDF and jsPDF-AutoTable (PDF) and qrcode-generator (share code), all MIT |
