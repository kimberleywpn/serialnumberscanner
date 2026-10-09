# Label Lens

A mobile-friendly OCR scanner for serial text printed below QR codes.

## Use

1. Tap **Take photo** or **Upload**.
2. Rotate the photo until the serial text is horizontal.
3. Drag and resize the orange box to include one serial.
4. Tap **Scan text** to add the detected code to the list.
5. Use **Copy** for one code or **Copy all** for a newline-separated list.

Scans are saved in this browser on this device. Images are processed in the browser. The OCR library and language data require an internet connection to load.

## Publish with GitHub Pages

Upload `index.html` and `.nojekyll` to the root of a GitHub repository. Then open **Settings → Pages**, choose **Deploy from a branch**, and select **main** and **/(root)**. Save and wait for GitHub to report the published URL.

The resulting website is publicly accessible. The source package contains no uploaded photos, saved scan results, or account credentials.

## Edit

The HTML, styles, and scanner code are contained in `index.html`. No build step is required. Push changes to the publishing branch to update the website.

