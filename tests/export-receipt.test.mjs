import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  inferImageMimeType,
  readImageDimensions,
} from "../src/talk_to_figma_mcp/image-dimensions.mjs";
import {
  buildExportReceipt,
  buildImageFillReceipt,
} from "../src/talk_to_figma_mcp/export-receipt.mjs";

function pngWith(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpegWith(width, height, { marker = 0xc0, precedingSegments = [] } = {}) {
  const parts = [Buffer.from([0xff, 0xd8])];
  for (const segmentMarker of precedingSegments) {
    const segment = Buffer.alloc(6);
    segment[0] = 0xff;
    segment[1] = segmentMarker;
    segment.writeUInt16BE(4, 2);
    parts.push(segment);
  }
  const sof = Buffer.alloc(11);
  sof[0] = 0xff;
  sof[1] = marker;
  sof.writeUInt16BE(8, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof);
  return Buffer.concat(parts);
}

test("PNG and JPEG dimensions are parsed from the exported bytes", () => {
  assert.deepEqual(readImageDimensions(pngWith(1440, 900), "image/png"), {
    width: 1440,
    height: 900,
    dimensionSource: "png-ihdr",
  });

  assert.deepEqual(readImageDimensions(jpegWith(320, 180), "image/jpeg"), {
    width: 320,
    height: 180,
    dimensionSource: "jpeg-sof",
  });

  // 0xc4 (DHT), 0xc8 (JPG) and 0xcc (DAC) sit inside the SOF numeric range but are not
  // frame headers. Treating one as a frame header yields confident nonsense.
  assert.deepEqual(
    readImageDimensions(
      jpegWith(64, 32, { precedingSegments: [0xc4, 0xc8, 0xcc, 0xe0] }),
      "image/jpeg",
    ),
    { width: 64, height: 32, dimensionSource: "jpeg-sof" },
  );

  // Progressive JPEG uses SOF2.
  assert.deepEqual(
    readImageDimensions(jpegWith(800, 600, { marker: 0xc2 }), "image/jpeg"),
    { width: 800, height: 600, dimensionSource: "jpeg-sof" },
  );
});

test("SVG prefers explicit pixel attributes and falls back to the viewBox", () => {
  const withAttributes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240px" height="120" viewBox="0 0 999 999"></svg>',
  );
  assert.deepEqual(readImageDimensions(withAttributes, "image/svg+xml"), {
    width: 240,
    height: 120,
    dimensionSource: "svg-attributes",
  });

  const viewBoxOnly = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 375 812"></svg>',
  );
  assert.deepEqual(readImageDimensions(viewBoxOnly, "image/svg+xml"), {
    width: 375,
    height: 812,
    dimensionSource: "svg-viewbox",
  });

  // Context-dependent units cannot be reported as pixels, so the viewBox wins.
  const relativeUnits = Buffer.from(
    '<svg width="100%" height="20em" viewBox="0 0 48 48"></svg>',
  );
  assert.deepEqual(readImageDimensions(relativeUnits, "image/svg+xml"), {
    width: 48,
    height: 48,
    dimensionSource: "svg-viewbox",
  });
});

test("unreadable formats report null rather than a fabricated size", () => {
  assert.equal(readImageDimensions(Buffer.from("%PDF-1.7\n"), "application/pdf"), null);
  assert.equal(readImageDimensions(Buffer.alloc(0), "image/png"), null);
  assert.equal(readImageDimensions(Buffer.from("not a png"), "image/png"), null);
  assert.equal(readImageDimensions(Buffer.from([0xff, 0xd8]), "image/jpeg"), null);
  assert.equal(readImageDimensions(Buffer.from("<html></html>"), "image/svg+xml"), null);
});

test("original image-fill bytes are sniffed rather than mislabeled as a node export format", () => {
  assert.equal(inferImageMimeType(pngWith(400, 300)), "image/png");
  assert.equal(inferImageMimeType(jpegWith(400, 300)), "image/jpeg");
  assert.equal(inferImageMimeType(Buffer.from("GIF89a", "ascii")), "image/gif");
  assert.equal(inferImageMimeType(Buffer.from("unknown bytes")), "application/octet-stream");

  const bytes = pngWith(400, 300);
  const receipt = buildImageFillReceipt(bytes, inferImageMimeType(bytes), {
    nodeId: "1:23",
    paintIndex: 0,
    imageHash: "figma-image-hash",
    imageFill: {
      type: "IMAGE",
      imageHash: "figma-image-hash",
      scaleMode: "CROP",
      imageTransform: [[0.5, 0, 0.25], [0, 0.5, 0.25]],
    },
    filePath: "/tmp/source-image.png",
  });

  assert.equal(receipt.nodeId, "1:23");
  assert.equal(receipt.paintIndex, 0);
  assert.equal(receipt.imageHash, "figma-image-hash");
  assert.equal(receipt.mimeType, "image/png");
  assert.equal(receipt.width, 400);
  assert.equal(receipt.height, 300);
  assert.equal(receipt.delivery, "file");
  assert.equal(receipt.path, "/tmp/source-image.png");
  assert.equal(receipt.imageFill.scaleMode, "CROP");
});

test("the export receipt identifies the export and reports its delivery mode", () => {
  const bytes = pngWith(1440, 900);
  const preflight = {
    projectedWidth: 1440,
    projectedHeight: 900,
    projectedMegapixels: 1.296,
    megapixelLimit: 16,
    overLimit: false,
    overrideUsed: false,
  };
  const inline = buildExportReceipt(bytes, "image/png", {
    nodeId: "1:23",
    format: "PNG",
    scale: 2,
    preflight,
  });

  assert.equal(inline.nodeId, "1:23");
  assert.equal(inline.format, "PNG");
  assert.equal(inline.scale, 2);
  assert.equal(inline.mimeType, "image/png");
  assert.equal(inline.bytes, bytes.length);
  assert.equal(inline.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(inline.width, 1440);
  assert.equal(inline.height, 900);
  assert.equal(inline.dimensionSource, "png-ihdr");
  assert.equal(inline.delivery, "inline");
  assert.deepEqual(inline.preflight, preflight);
  assert.ok(!("path" in inline), "an inline export has no file path");

  const toFile = buildExportReceipt(bytes, "image/png", {
    nodeId: "1:23",
    format: "PNG",
    scale: 2,
    filePath: "/tmp/export.png",
  });
  assert.equal(toFile.delivery, "file");
  assert.equal(toFile.path, "/tmp/export.png");
  assert.equal(toFile.sha256, inline.sha256, "the same bytes hash the same either way");
});

test("a PDF export still yields an attributable receipt with honest null dimensions", () => {
  const receipt = buildExportReceipt(Buffer.from("%PDF-1.7\n"), "application/pdf", {
    nodeId: "9:9",
    format: "PDF",
    scale: 1,
  });
  assert.equal(receipt.nodeId, "9:9");
  assert.equal(receipt.width, null);
  assert.equal(receipt.height, null);
  assert.equal(receipt.dimensionSource, null);
  assert.ok(receipt.sha256.length === 64);
});
