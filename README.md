# Label Lens

A mobile-friendly OCR scanner for serial text printed below QR codes.

## Use

1. Tap **Start live scan** and allow camera access. The rear camera is preferred on phones.
2. Hold one printed serial horizontally inside the orange box. You can drag or resize the box.
3. After two matching readings, scanning pauses and shows **Confirm serial**. Review or correct the detected text.
4. Tap **Add to list** to save it, or **Try again** to keep scanning. Already confirmed codes are skipped while the camera stays on.
5. Use **Copy** for one code or **Copy all** for a newline-separated list.

**Stop camera** releases the camera. Switching away from the page also stops it. You can restart scanning when you return.

For existing images, use **Take photo** or **Upload**, rotate the photo until the serial is horizontal, adjust the box, and tap **Scan text**. Photo results also require confirmation before being added.

Scans are saved in this browser on this device. Images and live camera frames are processed in the browser. The OCR library and language data require an internet connection to load. Live OCR checks one frame at a time; detection speed depends on the device, focus, lighting, and how steadily the label is held. Automatic live detection is tailored to the sample's `TAA` serial format.

## Publish with GitHub Pages

Upload `index.html`, `app.js`, and `.nojekyll` to the root of a GitHub repository. Then open **Settings → Pages**, choose **Deploy from a branch**, and select **main** and **/(root)**. Save and wait for GitHub to report the published URL.

The resulting website is publicly accessible. The source package contains no uploaded photos, saved scan results, or account credentials.

## Edit

The HTML and styles are in `index.html`; camera, OCR, and list behavior are in `app.js`. No build step is required. Push changes to the publishing branch to update the website.

