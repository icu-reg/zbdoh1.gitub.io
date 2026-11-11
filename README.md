# On-Call Log

A small iPhone-friendly web app for logging calls while on call and producing a PDF to send in to work.

- **Start on-call / End on-call** marks each on-call period.
- **Log a call** records the patient UR number and name, time, phone-only vs returned to hospital, who called, the reason, and minutes spent.
- **Create recall form (PDF)** fills in the Monash Health *Recall Form (without return to Hospital)* for an on-call period (or a date range, from the History tab) and opens the iPhone share sheet so it can be emailed. Phone-only calls within an hour of each other are grouped into one row; calls marked *Returned to hospital* are left off.
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
| `vendor/` | jsPDF and jsPDF-AutoTable (MIT), used to build the PDF |
