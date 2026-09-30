import { decode } from "@cf-wasm/png/workerd";
import jpeg from "jpeg-js";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIZE = 64;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json"
    }
  });
}

function isPNG(bytes) {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4E &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0D &&
    bytes[5] === 0x0A &&
    bytes[6] === 0x1A &&
    bytes[7] === 0x0A
  );
}

function isJPEG(bytes) {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xFF &&
    bytes[1] === 0xD8 &&
    bytes[2] === 0xFF
  );
}

export default {
  async fetch(request) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    if (request.method === "GET") {
      return json({
        success: true,
        message: "Roblox image pixel Worker is online!"
      });
    }

    if (request.method !== "POST") {
      return json({
        error: "POST requests only"
      }, 405);
    }

    try {
      const body = await request.json();

      if (!body.url || typeof body.url !== "string") {
        return json({
          error: "Missing image URL"
        }, 400);
      }

      let imageURL;

      try {
        imageURL = new URL(body.url);
      } catch {
        return json({
          error: "Invalid URL"
        }, 400);
      }

      if (imageURL.protocol !== "https:") {
        return json({
          error: "HTTPS URLs only"
        }, 400);
      }

      const imageResponse = await fetch(imageURL.toString(), {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "image/png,image/jpeg,image/*,*/*"
        }
      });

      if (!imageResponse.ok) {
        return json({
          error:
            "Image request failed: HTTP " +
            imageResponse.status
        }, 400);
      }

      const contentType =
        (imageResponse.headers.get("content-type") || "")
          .split(";")[0]
          .trim()
          .toLowerCase();

      const buffer = await imageResponse.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      if (bytes.length === 0) {
        return json({
          error: "Image response was empty"
        }, 400);
      }

      if (bytes.length > MAX_BYTES) {
        return json({
          error: "Image is too large",
          bytes: bytes.length,
          maxBytes: MAX_BYTES
        }, 413);
      }

      /*
       * Detect the actual file format from its magic bytes.
       * This is more reliable than Content-Type alone.
       */

      const actualPNG = isPNG(bytes);
      const actualJPEG = isJPEG(bytes);

      let sourceWidth;
      let sourceHeight;
      let rgba;

      if (actualPNG) {

        try {

          const png = decode(buffer);

          sourceWidth = png.width;
          sourceHeight = png.height;
          rgba = png.data;

        } catch (error) {

          return json({
            error: "PNG decoding failed",
            details: String(error),
            contentType,
            downloadedBytes: bytes.length
          }, 500);
        }

      } else if (actualJPEG) {

        try {

          const jpegImage = jpeg.decode(
            bytes,
            {
              useTArray: true,
              formatAsRGBA: true
            }
          );

          sourceWidth = jpegImage.width;
          sourceHeight = jpegImage.height;
          rgba = jpegImage.data;

        } catch (error) {

          return json({
            error: "JPEG decoding failed",
            details: String(error),
            contentType,
            downloadedBytes: bytes.length
          }, 500);
        }

      } else {

        /*
         * The URL may claim to be an image, but the returned
         * bytes aren't actually PNG or JPEG.
         */

        const preview = new TextDecoder()
          .decode(bytes.slice(0, 200));

        return json({
          error: "Downloaded file is not a PNG or JPEG",
          contentType: contentType || "unknown",
          downloadedBytes: bytes.length,
          firstBytes: Array.from(bytes.slice(0, 16)),
          responsePreview: preview
        }, 415);
      }

      if (
        !sourceWidth ||
        !sourceHeight ||
        !rgba
      ) {
        return json({
          error: "Decoder returned invalid image data"
        }, 500);
      }

      /*
       * Keep the returned pixel data small enough for Roblox.
       */

      const scale = Math.min(
        1,
        MAX_SIZE / sourceWidth,
        MAX_SIZE / sourceHeight
      );

      const width = Math.max(
        1,
        Math.floor(sourceWidth * scale)
      );

      const height = Math.max(
        1,
        Math.floor(sourceHeight * scale)
      );

      const pixels = [];

      for (let y = 0; y < height; y++) {

        const row = [];

        for (let x = 0; x < width; x++) {

          const sourceX = Math.min(
            sourceWidth - 1,
            Math.floor(x / scale)
          );

          const sourceY = Math.min(
            sourceHeight - 1,
            Math.floor(y / scale)
          );

          const index =
            (sourceY * sourceWidth + sourceX) * 4;

          row.push([
            rgba[index],
            rgba[index + 1],
            rgba[index + 2],
            rgba[index + 3]
          ]);
        }

        pixels.push(row);
      }

      return json({
        success: true,

        originalWidth: sourceWidth,
        originalHeight: sourceHeight,

        width,
        height,

        pixels
      });

    } catch (error) {

      console.error(error);

      return json({
        error: "Failed to process image",
        details: String(error)
      }, 500);
    }
  }
};
