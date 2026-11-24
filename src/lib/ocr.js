/**
 * ocr.js
 * On-device image OCR. Tesseract.js runs in a web worker in this browser tab;
 * the uploaded image is never sent to a server. Only the OCR engine and the
 * English language model are fetched (once) as static assets.
 */

let workerPromise = null;
let progressHandler = null;

const TARGET_WIDTH = 3600;
const MAX_SCALE = 3;

/**
 * Small report images OCR poorly. Upscale to roughly 2400px wide (at most 3x)
 * and flatten to grayscale, all on a local canvas.
 */
async function prepareImage(file) {
  try {
    if (
      typeof document === "undefined" ||
      typeof createImageBitmap !== "function"
    ) {
      return file;
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(
      MAX_SCALE,
      Math.max(1, TARGET_WIDTH / bitmap.width),
    );
    if (scale <= 1.01) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close?.();
      return file;
    }
    context.filter = "grayscale(1)";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng", 1, {
        logger: (message) => progressHandler?.(message),
      });
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/**
 * @param {File|Blob} file image to read
 * @param {(progress: {status: string, progress: number}) => void} [onProgress]
 * @returns {Promise<string>} recognised text
 */
export async function recognizeImage(file, onProgress) {
  progressHandler = onProgress ?? null;
  try {
    onProgress?.({ status: "loading tesseract core", progress: 0.02 });
    const worker = await getWorker();
    const prepared = await prepareImage(file);
    const { data } = await worker.recognize(prepared);
    onProgress?.({ status: "done", progress: 1 });
    return data.text;
  } finally {
    progressHandler = null;
  }
}
