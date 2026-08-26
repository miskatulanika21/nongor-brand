/**
 * Dedicated heavy-format decoder. HEIC/HEIF (libheif) and TIFF parsing stay off
 * the UI thread and are serialized to avoid multiplying large bitmap buffers.
 */
type DecodeRequest = {
  id: number;
  file: File;
  type: "image/heic" | "image/heif" | "image/tiff";
};

type DecodeSuccess = {
  id: number;
  ok: true;
  bitmap: ImageBitmap;
  orientation: number;
};

const MAX_DECODE_PIXELS = 80_000_000;

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

function assertDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_DECODE_PIXELS
  ) {
    throw new Error("invalid_dimensions");
  }
}

function toByte(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return value > 0 ? 255 : 0;
  return Math.max(0, Math.min(255, Math.round(((value - min) / (max - min)) * 255)));
}

async function decodeTiff(file: File): Promise<{ bitmap: ImageBitmap; orientation: number }> {
  const bytes = await file.arrayBuffer();
  const { decode } = await import("tiff");

  // Inspect dimensions before allocating the full decompressed pixel array.
  const [header] = decode(bytes, { ignoreImageData: true, pages: [0] });
  if (!header) throw new Error("invalid_tiff");
  assertDimensions(header.width, header.height);

  const [ifd] = decode(bytes, { pages: [0] });
  if (!ifd || ifd.data.length === 0) throw new Error("invalid_tiff");
  const { width, height, components, data } = ifd;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const min = Number.isFinite(ifd.sMinSampleValue) ? ifd.sMinSampleValue : 0;
  const max = Number.isFinite(ifd.sMaxSampleValue)
    ? ifd.sMaxSampleValue
    : 2 ** ifd.bitsPerSample - 1;

  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixel * components;
    const destination = pixel * 4;
    if (ifd.type === 3 && ifd.palette) {
      const [red, green, blue] = ifd.palette[Number(data[source])] ?? [0, 0, 0];
      rgba[destination] = toByte(red, 0, 65535);
      rgba[destination + 1] = toByte(green, 0, 65535);
      rgba[destination + 2] = toByte(blue, 0, 65535);
    } else if ((ifd.type === 0 || ifd.type === 1) && (components === 1 || components === 2)) {
      const value = toByte(Number(data[source]), min, max);
      const grey = ifd.type === 0 ? 255 - value : value;
      rgba[destination] = grey;
      rgba[destination + 1] = grey;
      rgba[destination + 2] = grey;
    } else if (ifd.type === 2 && components >= 3) {
      rgba[destination] = toByte(Number(data[source]), min, max);
      rgba[destination + 1] = toByte(Number(data[source + 1]), min, max);
      rgba[destination + 2] = toByte(Number(data[source + 2]), min, max);
    } else {
      throw new Error("unsupported_tiff");
    }
    rgba[destination + 3] = ifd.alpha
      ? toByte(Number(data[source + components - 1]), min, max)
      : 255;
  }

  return {
    bitmap: await createImageBitmap(new ImageData(rgba, width, height)),
    orientation: ifd.orientation >= 1 && ifd.orientation <= 8 ? ifd.orientation : 1,
  };
}

async function decodeHeavy(request: DecodeRequest): Promise<DecodeSuccess> {
  if (request.type === "image/tiff") {
    const decoded = await decodeTiff(request.file);
    return { id: request.id, ok: true, ...decoded };
  }

  const { heicTo } = await import("heic-to/csp");
  const bitmap = await heicTo({ blob: request.file, type: "bitmap" });
  try {
    assertDimensions(bitmap.width, bitmap.height);
    return { id: request.id, ok: true, bitmap, orientation: 1 };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

async function processRequest(request: DecodeRequest): Promise<void> {
  try {
    const response = await decodeHeavy(request);
    workerScope.postMessage(response, [response.bitmap]);
  } catch {
    workerScope.postMessage({ id: request.id, ok: false });
  }
}

let queue = Promise.resolve();
workerScope.onmessage = (event) => {
  queue = queue.then(() => processRequest(event.data));
};
