# Label Lens

A mobile-friendly QR-first serial scanner with printed-text OCR as a fallback.

## Use

1. Tap **Start live scan** and allow camera access. The rear camera is preferred on phones.
2. Point at one QR code and hold it steady. The frame is searched for supported QR data first; printed-text OCR is used if no supported QR is found.
3. When a QR serial is decoded, the frame freezes immediately. OCR results require two matching readings. You can also tap **Scan label** to capture the current frame manually.
4. Tap a yellow highlight or a serial chip below the preview. Review or correct the text, then use **Copy text** or **Add to list**. Copying does not save it. Tap **Cancel** to select something else, or **Continue scanning** for a fresh frame. Already confirmed codes are skipped.
5. Use **Copy** for one code or **Copy all** for a newline-separated list.

**Stop camera** releases the camera. Switching away from the page also stops it. You can restart scanning when you return.

For existing images, use **Take photo** or **Upload** and tap **Scan labels**. Multiple smaller QR-focused regions are searched to avoid confusing neighboring labels. Detected serials can be selected individually. If no supported QR is found, OCR is tried. You can enable **Use precision crop for difficult photos** to bypass QR scanning and read a cropped text line. Results require confirmation before being added. Some small, blurred, shadowed, or cut-off labels may need a closer photo.

## QR mapping and safety

Plain `TAA` serials in QR data are read directly. For SIRIM links matching the sample's `https://sqasiapps.sirim.my/index` format (`v=1.1`, `c=I1NR`, `o=A`), the recognized 22-byte payload has a big-endian counter at bytes 8–11. Four sample pairs matched `TAA8` plus the six-digit value of `counter + 1`. This mapping is inferred for the sample label series, not an officially confirmed universal SIRIM format. QR-derived estimates are visibly labeled and must be checked against the printed serial before saving.

The website never opens QR URLs automatically, sends label tokens to SIRIM, or claims to verify authenticity. Unknown QR formats fall back to OCR. No serial is saved without the user tapping **Add to list**.

This is an iPhone-inspired web interaction, not Apple's native Live Text engine. It runs on compatible mobile browsers using Tesseract.js OCR.

Scans are saved in this browser on this device. Images and live camera frames are processed in the browser. The OCR library and language data require an internet connection to load. Live OCR checks one frame at a time; detection speed depends on the device, focus, lighting, and how steadily the label is held. Automatic live detection is tailored to the sample's `TAA` serial format.

## Publish with GitHub Pages

Upload `index.html`, `scanner-qr.js`, `qr-core.js`, and `.nojekyll` to the root of a GitHub repository. Then open **Settings → Pages**, choose **Deploy from a branch**, and select **main** and **/(root)**. Save and wait for GitHub to report the published URL.

The resulting website is publicly accessible. The source package contains no uploaded photos, saved scan results, or account credentials.

## Edit

The HTML and styles are in `index.html`; camera, OCR, and list behavior are in `scanner-qr.js`; QR payload parsing and region search are in `qr-core.js`. No build step is required. [jsQR](https://github.com/cozmo/jsQR) 1.4.0 and Tesseract.js 5.1.1 are loaded from jsDelivr. Push changes to the publishing branch to update the website. Earlier script assets are retained so cached versions of the old page still work.

