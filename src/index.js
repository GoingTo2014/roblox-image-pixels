import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIZE = 64;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return json({
        error: "Send a POST request containing { url: '...' }"
      }, 405);
    }

    try {
      const body = await request.json();

      if (!body.url || typeof body.url !== "string") {
        return json({ error: "Missing image URL" }, 400);
      }

      let imageURL;

      try {
        imageURL = new URL(body.url);
      } catch {
        return json({ error: "Invalid URL" }, 400);
      }

      if (imageURL.protocol !== "https:") {
        return json({ error: "HTTPS URLs only" }, 400);
      }

      const response = await fetch(imageURL);

      if (!response.ok) {
        return json({
          error: `Image request failed: HTTP ${response.status}`
        }, 400);
      }

      const contentType =
        (response.headers.get("content-type") || "")
          .split(";")[0]
          .toLowerCase();

      if (
        contentType !== "image/png" &&
        contentType !== "image/jpeg"
      ) {
        return json({
          error: `Unsupported image type: ${contentType || "unknown"}`
        }, 415);
      }

      const buffer = await response.arrayBuffer();

      if (buffer.byteLength > MAX_BYTES) {
        return json({ error: "Image is too large" }, 413);
      }

      let decoded;

      if (contentType === "image/png") {
        const png = PNG.sync.read(Buffer.from(buffer));

        decoded = {
          width: png.width,
          height: png.height,
          data: png.data
        };
      } else {
        decoded = jpeg.decode(new Uint8Array(buffer), {
          useTArray: true,
          formatAsRGBA: true
        });
      }

      const sourceWidth = decoded.width;
      const sourceHeight = decoded.height;

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
            decoded.data[index],
            decoded.data[index + 1],
            decoded.data[index + 2],
            decoded.data[index + 3]
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
      return json({
        error: "Failed to process image"
      }, 500);
    }
  }
};
