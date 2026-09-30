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


// ============================================================
// IMAGE FORMAT DETECTION
// ============================================================

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


// ============================================================
// PNG RGBA NORMALIZATION
// ============================================================

function pngToRGBA(png) {

    const width = png.width;
    const height = png.height;
    const source = png.image;

    const colorType = png.colorType;
    const bitDepth = png.bitDepth;
    const lineSize = png.lineSize;

    if (!source) {
        throw new Error("PNG decoder returned no image data");
    }

    if (!width || !height) {
        throw new Error("PNG decoder returned invalid dimensions");
    }

    /*
     * We currently handle 8-bit PNGs here.
     *
     * colorType:
     *
     * 0 = grayscale
     * 2 = RGB
     * 3 = indexed/palette
     * 4 = grayscale + alpha
     * 6 = RGBA
     */

    if (bitDepth !== 8) {
        throw new Error(
            "Unsupported PNG bit depth: " +
            bitDepth +
            ". Only 8-bit PNGs are currently supported."
        );
    }

    let channels;

    switch (colorType) {

        case 0:
            // Grayscale
            channels = 1;
            break;

        case 2:
            // RGB
            channels = 3;
            break;

        case 4:
            // Grayscale + alpha
            channels = 2;
            break;

        case 6:
            // RGBA
            channels = 4;
            break;

        default:
            throw new Error(
                "Unsupported PNG color type: " +
                colorType
            );
    }

    /*
     * lineSize is supplied by the decoder and represents
     * the number of bytes in one decoded row.
     */

    const expectedLineSize =
        width * channels;

    const actualLineSize =
        lineSize || expectedLineSize;

    if (actualLineSize < expectedLineSize) {
        throw new Error(
            "PNG line size is too small. " +
            "Expected at least " +
            expectedLineSize +
            ", got " +
            actualLineSize
        );
    }

    const rgba =
        new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {

        const sourceRowStart =
            y * actualLineSize;

        const outputRowStart =
            y * width * 4;

        for (let x = 0; x < width; x++) {

            const sourceIndex =
                sourceRowStart +
                x * channels;

            const outputIndex =
                outputRowStart +
                x * 4;

            if (
                sourceIndex + channels >
                source.length
            ) {
                throw new Error(
                    "PNG pixel data ended unexpectedly at " +
                    x +
                    "," +
                    y
                );
            }

            if (colorType === 0) {

                // -----------------------------
                // Grayscale
                // -----------------------------

                const gray =
                    source[sourceIndex];

                rgba[outputIndex] =
                    gray;

                rgba[outputIndex + 1] =
                    gray;

                rgba[outputIndex + 2] =
                    gray;

                rgba[outputIndex + 3] =
                    255;

            } else if (colorType === 2) {

                // -----------------------------
                // RGB
                // -----------------------------

                rgba[outputIndex] =
                    source[sourceIndex];

                rgba[outputIndex + 1] =
                    source[sourceIndex + 1];

                rgba[outputIndex + 2] =
                    source[sourceIndex + 2];

                rgba[outputIndex + 3] =
                    255;

            } else if (colorType === 4) {

                // -----------------------------
                // Grayscale + Alpha
                // -----------------------------

                const gray =
                    source[sourceIndex];

                const alpha =
                    source[sourceIndex + 1];

                rgba[outputIndex] =
                    gray;

                rgba[outputIndex + 1] =
                    gray;

                rgba[outputIndex + 2] =
                    gray;

                rgba[outputIndex + 3] =
                    alpha;

            } else if (colorType === 6) {

                // -----------------------------
                // RGBA
                // -----------------------------

                rgba[outputIndex] =
                    source[sourceIndex];

                rgba[outputIndex + 1] =
                    source[sourceIndex + 1];

                rgba[outputIndex + 2] =
                    source[sourceIndex + 2];

                rgba[outputIndex + 3] =
                    source[sourceIndex + 3];
            }
        }
    }

    return rgba;
}


// ============================================================
// MAIN WORKER
// ============================================================

export default {

    async fetch(request) {

        // ------------------------------------------------------
        // CORS
        // ------------------------------------------------------

        if (request.method === "OPTIONS") {

            return new Response(null, {
                status: 204,
                headers: CORS_HEADERS
            });
        }


        // ------------------------------------------------------
        // HEALTH CHECK
        // ------------------------------------------------------

        if (request.method === "GET") {

            return json({
                success: true,
                message:
                    "Roblox image pixel Worker is online!"
            });
        }


        // ------------------------------------------------------
        // POST ONLY
        // ------------------------------------------------------

        if (request.method !== "POST") {

            return json({
                error: "POST requests only"
            }, 405);
        }


        try {

            // --------------------------------------------------
            // REQUEST BODY
            // --------------------------------------------------

            const body =
                await request.json();

            if (
                !body.url ||
                typeof body.url !== "string"
            ) {

                return json({
                    error:
                        "Missing image URL"
                }, 400);
            }


            // --------------------------------------------------
            // URL
            // --------------------------------------------------

            let imageURL;

            try {

                imageURL =
                    new URL(body.url);

            } catch {

                return json({
                    error:
                        "Invalid URL"
                }, 400);
            }


            if (
                imageURL.protocol !==
                "https:"
            ) {

                return json({
                    error:
                        "HTTPS URLs only"
                }, 400);
            }


            // --------------------------------------------------
            // FETCH IMAGE
            // --------------------------------------------------

            const imageResponse =
                await fetch(
                    imageURL.toString(),
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0",

                            "Accept":
                                "image/png,image/jpeg,image/*,*/*"
                        }
                    }
                );


            if (!imageResponse.ok) {

                return json({
                    error:
                        "Image request failed: HTTP " +
                        imageResponse.status
                }, 400);
            }


            // --------------------------------------------------
            // CONTENT TYPE
            // --------------------------------------------------

            const contentType =
                (
                    imageResponse.headers.get(
                        "content-type"
                    ) || ""
                )
                    .split(";")[0]
                    .trim()
                    .toLowerCase();


            // --------------------------------------------------
            // READ BYTES
            // --------------------------------------------------

            const buffer =
                await imageResponse.arrayBuffer();

            const bytes =
                new Uint8Array(buffer);


            if (bytes.length === 0) {

                return json({
                    error:
                        "Image response was empty"
                }, 400);
            }


            if (
                bytes.length >
                MAX_BYTES
            ) {

                return json({
                    error:
                        "Image is too large",

                    downloadedBytes:
                        bytes.length,

                    maxBytes:
                        MAX_BYTES
                }, 413);
            }


            // --------------------------------------------------
            // DETECT FORMAT
            // --------------------------------------------------

            const actualPNG =
                isPNG(bytes);

            const actualJPEG =
                isJPEG(bytes);


            let sourceWidth;
            let sourceHeight;
            let rgba;


            // ==================================================
            // PNG
            // ==================================================

            if (actualPNG) {

                try {

                    const png =
                        decode(bytes);

                    sourceWidth =
                        png.width;

                    sourceHeight =
                        png.height;

                    rgba =
                        pngToRGBA(png);

                } catch (error) {

                    return json({
                        error:
                            "PNG decoding failed",

                        details:
                            String(error),

                        contentType,

                        downloadedBytes:
                            bytes.length
                    }, 500);
                }
            }


            // ==================================================
            // JPEG
            // ==================================================

            else if (actualJPEG) {

                try {

                    const jpegImage =
                        jpeg.decode(
                            bytes,
                            {
                                useTArray: true,
                                formatAsRGBA: true
                            }
                        );

                    sourceWidth =
                        jpegImage.width;

                    sourceHeight =
                        jpegImage.height;

                    rgba =
                        jpegImage.data;

                } catch (error) {

                    return json({
                        error:
                            "JPEG decoding failed",

                        details:
                            String(error),

                        contentType,

                        downloadedBytes:
                            bytes.length
                    }, 500);
                }
            }


            // ==================================================
            // UNKNOWN
            // ==================================================

            else {

                let preview = "";

                try {

                    preview =
                        new TextDecoder()
                            .decode(
                                bytes.slice(
                                    0,
                                    200
                                )
                            );

                } catch {

                    preview = "";
                }


                return json({

                    error:
                        "Downloaded file is not a PNG or JPEG",

                    contentType:
                        contentType ||
                        "unknown",

                    downloadedBytes:
                        bytes.length,

                    firstBytes:
                        Array.from(
                            bytes.slice(
                                0,
                                16
                            )
                        ),

                    responsePreview:
                        preview

                }, 415);
            }


            // --------------------------------------------------
            // FINAL VALIDATION
            // --------------------------------------------------

            if (
                !sourceWidth ||
                !sourceHeight ||
                !rgba
            ) {

                return json({

                    error:
                        "Decoder returned invalid image data",

                    sourceWidth,
                    sourceHeight,

                    pixelBytes:
                        rgba
                            ? rgba.length
                            : 0

                }, 500);
            }


            /*
             * The normalized RGBA buffer MUST contain exactly
             * width * height * 4 bytes.
             */

            const expectedRGBABytes =
                sourceWidth *
                sourceHeight *
                4;


            if (
                rgba.length !==
                expectedRGBABytes
            ) {

                return json({

                    error:
                        "RGBA conversion produced an invalid size",

                    sourceWidth,
                    sourceHeight,

                    expectedBytes:
                        expectedRGBABytes,

                    actualBytes:
                        rgba.length

                }, 500);
            }


            // ==================================================
            // RESIZE / SAMPLE
            // ==================================================

            const scale =
                Math.min(
                    1,
                    MAX_SIZE /
                        sourceWidth,
                    MAX_SIZE /
                        sourceHeight
                );


            const width =
                Math.max(
                    1,
                    Math.floor(
                        sourceWidth *
                        scale
                    )
                );


            const height =
                Math.max(
                    1,
                    Math.floor(
                        sourceHeight *
                        scale
                    )
                );


            // --------------------------------------------------
            // OUTPUT PIXELS
            // --------------------------------------------------

            const pixels = [];


            for (
                let y = 0;
                y < height;
                y++
            ) {

                const row = [];


                for (
                    let x = 0;
                    x < width;
                    x++
                ) {

                    /*
                     * Map the output pixel back to the
                     * original image.
                     */

                    const sourceX =
                        Math.min(
                            sourceWidth - 1,

                            Math.floor(
                                x / scale
                            )
                        );


                    const sourceY =
                        Math.min(
                            sourceHeight - 1,

                            Math.floor(
                                y / scale
                            )
                        );


                    const index =
                        (
                            sourceY *
                            sourceWidth +
                            sourceX
                        ) * 4;


                    /*
                     * Because rgba was normalized above,
                     * these four values are guaranteed to
                     * exist.
                     */

                    row.push([
                        rgba[index],
                        rgba[index + 1],
                        rgba[index + 2],
                        rgba[index + 3]
                    ]);
                }


                pixels.push(row);
            }


            // --------------------------------------------------
            // FINAL NULL CHECK
            // --------------------------------------------------

            for (
                let y = 0;
                y < pixels.length;
                y++
            ) {

                for (
                    let x = 0;
                    x < pixels[y].length;
                    x++
                ) {

                    const pixel =
                        pixels[y][x];

                    if (
                        pixel[0] === undefined ||
                        pixel[1] === undefined ||
                        pixel[2] === undefined ||
                        pixel[3] === undefined
                    ) {

                        return json({

                            error:
                                "Internal pixel conversion error",

                            x,
                            y,

                            pixel

                        }, 500);
                    }
                }
            }


            // ==================================================
            // RESPONSE
            // ==================================================

            return json({

                success: true,

                originalWidth:
                    sourceWidth,

                originalHeight:
                    sourceHeight,

                width,
                height,

                pixels

            });


        } catch (error) {

            console.error(error);

            return json({

                error:
                    "Failed to process image",

                details:
                    String(error)

            }, 500);
        }
    }
};
