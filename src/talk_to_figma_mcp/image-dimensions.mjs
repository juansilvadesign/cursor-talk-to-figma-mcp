// Dependency-free intrinsic-dimension reader for the formats export_node_as_image
// can return. It parses the bytes Figma actually produced rather than multiplying the
// node's box by the requested scale, so the reported size is the exported artifact's
// own size. Anything it cannot read honestly reports null instead of guessing.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const GIF_SIGNATURES = new Set(["GIF87a", "GIF89a"]);

// SOF0-SOF3, SOF5-SOF7, SOF9-SOF11, SOF13-SOF15 carry the frame header.
// 0xc4 (DHT), 0xc8 (JPG extension) and 0xcc (DAC) sit in the same numeric range
// but are not frame headers, so they must not be treated as one.
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readPng(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    dimensionSource: "png-ihdr",
  };
}

function readJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];

    // Padding fill bytes, and the standalone markers that carry no length field.
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      return null;
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      // marker(2) + length(2) + precision(1) => height, then width
      if (offset + 9 > buffer.length) {
        return null;
      }
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        dimensionSource: "jpeg-sof",
      };
    }

    offset += 2 + segmentLength;
  }

  return null;
}

function parseLength(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }
  // Only unitless values and px are safe to report as pixels. em/%/pt depend on a
  // rendering context this server does not have.
  const match = rawValue.trim().match(/^([0-9]*\.?[0-9]+)(px)?$/i);
  if (!match) {
    return null;
  }
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function readSvg(buffer) {
  // Only the opening <svg> tag is needed; large documents should not be fully scanned.
  const head = buffer.toString("utf8", 0, Math.min(buffer.length, 4096));
  const openingTag = head.match(/<svg\b[^>]*>/i);
  if (!openingTag) {
    return null;
  }
  const tag = openingTag[0];

  const width = parseLength(tag.match(/\bwidth\s*=\s*"([^"]*)"/i)?.[1]);
  const height = parseLength(tag.match(/\bheight\s*=\s*"([^"]*)"/i)?.[1]);
  if (width !== null && height !== null) {
    return { width, height, dimensionSource: "svg-attributes" };
  }

  const viewBox = tag.match(/\bviewBox\s*=\s*"([^"]*)"/i)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((part) => Number.isFinite(part))) {
      return { width: parts[2], height: parts[3], dimensionSource: "svg-viewbox" };
    }
  }

  return null;
}

/**
 * Infer a portable MIME type from bytes received from Figma's Image API.
 *
 * Image.getBytesAsync() returns the stored file bytes but does not expose a MIME type.
 * Do not borrow the node export's requested format: this is an original image fill, not
 * a re-encoded node export. Unknown data stays opaque rather than being mislabeled.
 *
 * @param {Buffer} buffer image bytes
 * @returns {string}
 */
export function inferImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return "application/octet-stream";
  }
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (buffer.length >= JPEG_SIGNATURE.length && buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  if (buffer.length >= 6 && GIF_SIGNATURES.has(buffer.toString("ascii", 0, 6))) {
    return "image/gif";
  }
  return "application/octet-stream";
}

/**
 * @param {Buffer} buffer exported bytes
 * @param {string} mimeType the plugin-reported MIME type
 * @returns {{width: number, height: number, dimensionSource: string} | null}
 */
export function readImageDimensions(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }
  switch (mimeType) {
    case "image/png":
      return readPng(buffer);
    case "image/jpeg":
      return readJpeg(buffer);
    case "image/svg+xml":
      return readSvg(buffer);
    // PDF has no single intrinsic pixel size; reporting one would be a fabrication.
    default:
      return null;
  }
}
