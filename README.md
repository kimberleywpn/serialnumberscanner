# Label Lens

A mobile-friendly OCR scanner for serial text printed below QR codes.

## Use

1. Tap **Start live scan** and allow camera access. The rear camera is preferred on phones.
2. Point at a label and hold the serial horizontally. The entire camera frame is scanned; no crop box is needed.
3. After two matching readings, the frame freezes and detected serials are highlighted. You can also tap **Scan Text** to capture the current frame manually.
4. Tap a yellow highlight or a serial chip below the preview. Review or correct the text, then use **Copy text** or **Add to list**. Copying does not save it. Tap **Cancel** to select something else, or **Continue scanning** for a fresh frame. Already confirmed codes are skipped.
5. Use **Copy** for one code or **Copy all** for a newline-separated list.

**Stop camera** releases the camera. Switching away from the page also stops it. You can restart scanning when you return.

For existing images, use **Take photo** or **Upload**, rotate the photo until the serial is horizontal, and tap **Scan text**. Detected serials can be selected individually. If full-image recognition fails, enable **Use precision crop for difficult photos**, adjust the box, and scan again. Results require confirmation before being added.

This is an iPhone-inspired web interaction, not Apple's native Live Text engine. It runs on compatible mobile browsers using Tesseract.js OCR.

Scans are saved in this browser on this device. Images and live camera frames are processed in the browser. The OCR library and language data require an internet connection to load. Live OCR checks one frame at a time; detection speed depends on the device, focus, lighting, and how steadily the label is held. Automatic live detection is tailored to the sample's `TAA` serial format.

## Publish with GitHub Pages

Upload `index.html`, `scan-text.js`, and `.nojekyll` to the root of a GitHub repository. Then open **Settings → Pages**, choose **Deploy from a branch**, and select **main** and **/(root)**. Save and wait for GitHub to report the published URL.

The resulting website is publicly accessible. The source package contains no uploaded photos, saved scan results, or account credentials.

## Edit

The HTML and styles are in `index.html`; camera, OCR, and list behavior are in `scan-text.js`. No build step is required. Push changes to the publishing branch to update the website. The earlier `app.js` is retained in the repository so cached versions of the old page still work.

