import { createHash } from "crypto";

import { readImageDimensions } from "./image-dimensions.mjs";

/**
 * Build the typed receipt that identifies an export.
 *
 * The MCP image content block carries only `data` and `mimeType`, so before R1 a caller
 * could attribute an export only by remembering its own request. The receipt makes the
 * reply self-sufficient, and `delivery` tells the caller whether the bytes are in the
 * transcript or on disk.
 *
 * @param {Buffer} bytes decoded export bytes
 * @param {string} mimeType the plugin-reported MIME type
 * @param {{nodeId: string, format: string, scale: number, filePath?: string, preflight?: Record<string, unknown>}} request
 * @returns {Record<string, unknown>}
 */
export function buildExportReceipt(bytes, mimeType, request) {
  const dimensions = readImageDimensions(bytes, mimeType);
  const receipt = {
    nodeId: request.nodeId,
    format: request.format,
    scale: request.scale,
    mimeType,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: dimensions ? dimensions.width : null,
    height: dimensions ? dimensions.height : null,
    // Null width/height is a real answer for PDF and for unreadable headers. This field
    // says how a reported size was obtained, so a consumer never has to guess whether a
    // dimension was parsed or assumed.
    dimensionSource: dimensions ? dimensions.dimensionSource : null,
    delivery: request.filePath ? "file" : "inline",
  };
  if (request.filePath) {
    receipt.path = request.filePath;
  }
  if (request.preflight) {
    receipt.preflight = request.preflight;
  }
  return receipt;
}

/**
 * Build a receipt for original bytes read from one exact IMAGE paint.
 *
 * Unlike node export, this never rasterizes a node or chooses a format/scale. The paint
 * metadata is retained because its crop and blend settings describe how the original image
 * is used on the named node; the bytes alone do not establish that relationship.
 *
 * @param {Buffer} bytes decoded original image bytes
 * @param {string} mimeType sniffed MIME type
 * @param {{nodeId: string, paintIndex: number, imageHash: string, imageFill: Record<string, unknown>, filePath?: string}} request
 * @returns {Record<string, unknown>}
 */
export function buildImageFillReceipt(bytes, mimeType, request) {
  const dimensions = readImageDimensions(bytes, mimeType);
  const receipt = {
    nodeId: request.nodeId,
    paintIndex: request.paintIndex,
    imageHash: request.imageHash,
    imageFill: request.imageFill,
    mimeType,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: dimensions ? dimensions.width : null,
    height: dimensions ? dimensions.height : null,
    dimensionSource: dimensions ? dimensions.dimensionSource : null,
    delivery: request.filePath ? "file" : "inline",
  };
  if (request.filePath) {
    receipt.path = request.filePath;
  }
  return receipt;
}
