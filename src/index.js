import { decode } from "@cf-wasm/png/workerd";
import jpeg from "jpeg-js";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIZE = 1024;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
};

function json(data, status = 200) {
    return new Response(
        JSON.stringify(data),
        {
            status,
            headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/json"
            }
        }
    );
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

/*
 * Convert PNG decoder output to RGBA8.

 * The Cloudflare image transformation normally gives us
 * an already-small image, so this function only has to deal
 * with the transformed image rather than the original source.
 */
function pngToRGBA(png) {
    const width = png.width;
    const height = png.height;
    const source = png.image;

    const colorType = png.colorType;
    const bitDepth = png.bitDepth;
    const lineSize =
        png.lineSize || 0;

    if (!source) {
        throw new Error(
            "PNG decoder returned no image data"
        );
    }

    if (!width || !height) {
        throw new Error(
            "PNG decoder returned invalid dimensions"
        );
    }

    if (bitDepth !== 8) {
        throw new Error(
            "Unsupported PNG bit depth: " +
            bitDepth
        );
    }

    /*
     * Fast path:
     *
     * color type 6 = RGBA.
     *
     * The decoder already gave us exactly what
     * EditableImage ultimately needs.
     */
    if (colorType === 6) {
        const expected =
            width *
            height *
            4;

        if (source.length !== expected) {
            throw new Error(
                "RGBA PNG has invalid pixel data size. " +
                "Expected " +
                expected +
                ", got " +
                source.length
            );
        }

        return {
            width,
            height,
            channels: 4,
            pixels: source
        };
    }

    /*
     * RGB PNG.
     *
     * Convert RGB → RGBA.
     */
    if (colorType === 2) {
        const sourceLineSize =
            lineSize ||
            width * 3;

        const rgba =
            new Uint8Array(
                width *
                height *
                4
            );

        /*
         * One loop is required here because
         * we need to insert alpha bytes.
         */
        for (
            let y = 0;
            y < height;
            y++
        ) {
            const sourceRow =
                y *
                sourceLineSize;

            const outputRow =
                y *
                width *
                4;

            for (
                let x = 0;
                x < width;
                x++
            ) {
                const sourceIndex =
                    sourceRow +
                    x * 3;

                const outputIndex =
                    outputRow +
                    x * 4;

                rgba[outputIndex] =
                    source[sourceIndex];

                rgba[outputIndex + 1] =
                    source[sourceIndex + 1];

                rgba[outputIndex + 2] =
                    source[sourceIndex + 2];

                rgba[outputIndex + 3] =
                    255;
            }
        }

        return {
            width,
            height,
            channels: 4,
            pixels: rgba
        };
    }

    /*
     * Grayscale PNG.
     */
    if (colorType === 0) {
        const sourceLineSize =
            lineSize ||
            width;

        const rgba =
            new Uint8Array(
                width *
                height *
                4
            );

        for (
            let y = 0;
            y < height;
            y++
        ) {
            const sourceRow =
                y *
                sourceLineSize;

            const outputRow =
                y *
                width *
                4;

            for (
                let x = 0;
                x < width;
                x++
            ) {
                const gray =
                    source[
                        sourceRow + x
                    ];

                const outputIndex =
                    outputRow +
                    x * 4;

                rgba[outputIndex] =
                    gray;

                rgba[outputIndex + 1] =
                    gray;

                rgba[outputIndex + 2] =
                    gray;

                rgba[outputIndex + 3] =
                    255;
            }
        }

        return {
            width,
            height,
            channels: 4,
            pixels: rgba
        };
    }

    /*
     * Grayscale + alpha PNG.
     */
    if (colorType === 4) {
        const sourceLineSize =
            lineSize ||
            width * 2;

        const rgba =
            new Uint8Array(
                width *
                height *
                4
            );

        for (
            let y = 0;
            y < height;
            y++
        ) {
            const sourceRow =
                y *
                sourceLineSize;

            const outputRow =
                y *
                width *
                4;

            for (
                let x = 0;
                x < width;
                x++
            ) {
                const sourceIndex =
                    sourceRow +
                    x * 2;

                const outputIndex =
                    outputRow +
                    x * 4;

                const gray =
                    source[sourceIndex];

                rgba[outputIndex] =
                    gray;

                rgba[outputIndex + 1] =
                    gray;

                rgba[outputIndex + 2] =
                    gray;

                rgba[outputIndex + 3] =
                    source[
                        sourceIndex + 1
                    ];
            }
        }

        return {
            width,
            height,
            channels: 4,
            pixels: rgba
        };
    }

    throw new Error(
        "Unsupported PNG color type: " +
        colorType
    );
}

export default {
    async fetch(request) {
        /*
         * CORS preflight.
         */
        if (
            request.method ===
            "OPTIONS"
        ) {
            return new Response(
                null,
                {
                    status: 204,
                    headers:
                        CORS_HEADERS
                }
            );
        }

        /*
         * Health check.
         */
        if (
            request.method ===
            "GET"
        ) {
            return json({
                success: true,
                message:
                    "Roblox image pixel Worker is online!",
                maxSize:
                    MAX_SIZE,
                outputFormat:
                    "raw-rgba-binary",
                imageTransformation:
                    true
            });
        }

        /*
         * Only POST is accepted.
         */
        if (
            request.method !==
            "POST"
        ) {
            return json(
                {
                    error:
                        "POST requests only"
                },
                405
            );
        }

        try {
            /*
             * Parse request.
             */
            const body =
                await request.json();

            /*
             * Validate image URL.
             */
            if (
                !body.url ||
                typeof body.url !==
                    "string"
            ) {
                return json(
                    {
                        error:
                            "Missing image URL"
                    },
                    400
                );
            }

            let imageURL;

            try {
                imageURL =
                    new URL(body.url);
            } catch {
                return json(
                    {
                        error:
                            "Invalid URL"
                    },
                    400
                );
            }

            if (
                imageURL.protocol !==
                "https:"
            ) {
                return json(
                    {
                        error:
                            "HTTPS URLs only"
                    },
                    400
                );
            }

            /*
             * Requested maximum output size.
             *
             * Server always clamps this to 1024.
             */
            let requestedSize =
                Number(
                    body.maxSize
                );

            if (
                !Number.isFinite(
                    requestedSize
                )
            ) {
                requestedSize =
                    MAX_SIZE;
            }

            const maxSize =
                Math.max(
                    1,
                    Math.min(
                        MAX_SIZE,
                        Math.floor(
                            requestedSize
                        )
                    )
                );

            /*
             * IMPORTANT:
             *
             * Cloudflare performs the resizing here.
             *
             * The Worker does NOT download the huge
             * original and resize it in JavaScript.
             */
            let imageResponse;

            try {
                imageResponse =
                    await fetch(
                        imageURL.toString(),
                        {
                            headers: {
                                "User-Agent":
                                    "Mozilla/5.0",

                                "Accept":
                                    "image/png,image/jpeg,image/*,*/*"
                            },

                            cf: {
                                image: {
                                    width:
                                        maxSize,

                                    height:
                                        maxSize,

                                    fit:
                                        "scale-down",

                                    format:
                                        "png",

                                    metadata:
                                        "none"
                                }
                            }
                        }
                    );
            } catch (error) {
                return json(
                    {
                        error:
                            "Cloudflare image transformation failed",

                        details:
                            String(error)
                    },
                    502
                );
            }

            /*
             * Do not fall back to the original image.
             *
             * Falling back could bring the huge source image
             * back into the Worker and recreate the resource
             * problem we're trying to avoid.
             */
            if (
                !imageResponse.ok
            ) {
                return json(
                    {
                        error:
                            "Image transformation request failed",

                        status:
                            imageResponse.status,

                        statusText:
                            imageResponse.statusText
                    },
                    400
                );
            }

            /*
             * Get transformed image bytes.
             *
             * At this point Cloudflare should already have
             * reduced the dimensions to <= 1024×1024.
             */
            const transformedBuffer =
                await imageResponse.arrayBuffer();

            const transformedBytes =
                new Uint8Array(
                    transformedBuffer
                );

            if (
                transformedBytes.length === 0
            ) {
                return json(
                    {
                        error:
                            "Transformed image was empty"
                    },
                    400
                );
            }

            /*
             * Safety limit for the transformed image.
             *
             * 1024×1024 RGBA is about 4 MB, so 5 MB gives
             * enough room without allowing something enormous.
             */
            if (
                transformedBytes.length >
                MAX_BYTES
            ) {
                return json(
                    {
                        error:
                            "Transformed image is too large",

                        downloadedBytes:
                            transformedBytes.length,

                        maxBytes:
                            MAX_BYTES
                    },
                    413
                );
            }

            /*
             * Detect the format produced by Cloudflare.
             */
            const transformedIsPNG =
                isPNG(
                    transformedBytes
                );

            const transformedIsJPEG =
                isJPEG(
                    transformedBytes
                );

            let width;
            let height;
            let channels;
            let pixels;

            /*
             * PNG path.
             *
             * Cloudflare was asked for PNG, so this
             * should be the normal path.
             */
            if (transformedIsPNG) {
                try {
                    const png =
                        decode(
                            transformedBytes
                        );

                    const decoded =
                        pngToRGBA(png);

                    width =
                        decoded.width;

                    height =
                        decoded.height;

                    channels =
                        decoded.channels;

                    pixels =
                        decoded.pixels;

                } catch (error) {
                    return json(
                        {
                            error:
                                "Transformed PNG decoding failed",

                            details:
                                String(error)
                        },
                        500
                    );
                }

            /*
             * JPEG fallback.
             */
            } else if (
                transformedIsJPEG
            ) {
                try {
                    const decoded =
                        jpeg.decode(
                            transformedBytes,
                            {
                                useTArray:
                                    true,

                                formatAsRGBA:
                                    true
                            }
                        );

                    width =
                        decoded.width;

                    height =
                        decoded.height;

                    channels =
                        4;

                    pixels =
                        decoded.data;

                } catch (error) {
                    return json(
                        {
                            error:
                                "Transformed JPEG decoding failed",

                            details:
                                String(error)
                        },
                        500
                    );
                }

            } else {
                return json(
                    {
                        error:
                            "Cloudflare returned an unsupported image format",

                        contentType:
                            imageResponse.headers.get(
                                "content-type"
                            ) || "unknown"
                    },
                    415
                );
            }

            /*
             * Final validation.
             */
            if (
                !width ||
                !height ||
                !pixels
            ) {
                return json(
                    {
                        error:
                            "Decoder returned invalid image data"
                    },
                    500
                );
            }

            if (
                width > MAX_SIZE ||
                height > MAX_SIZE
            ) {
                return json(
                    {
                        error:
                            "Cloudflare returned an image larger than the limit",

                        width,
                        height,
                        maxSize:
                            MAX_SIZE
                    },
                    500
                );
            }

            const expectedBytes =
                width *
                height *
                channels;

            if (
                pixels.length !==
                expectedBytes
            ) {
                return json(
                    {
                        error:
                            "Pixel buffer has an invalid size",

                        width,
                        height,
                        channels,

                        expectedBytes,

                        actualBytes:
                            pixels.length
                    },
                    500
                );
            }

            /*
             * Return raw binary pixels.
             *
             * NO:
             *   gzip
             *   base64
             *   JSON pixel arrays
             *   Content-Encoding
             *
             * Roblox's server script will put these bytes
             * into a buffer and compress them with native
             * Roblox Zstandard before sending them to the client.
             */
            return new Response(
                pixels,
                {
                    status: 200,

                    headers: {
                        ...CORS_HEADERS,

                        "Content-Type":
                            "application/octet-stream",

                        "Cache-Control":
                            "no-store",

                        "X-Image-Width":
                            String(
                                width
                            ),

                        "X-Image-Height":
                            String(
                                height
                            ),

                        "X-Image-Channels":
                            String(
                                channels
                            ),

                        "X-Image-Raw-Bytes":
                            String(
                                pixels.length
                            ),

                        "X-Image-Compression":
                            "none"
                    }
                }
            );

        } catch (error) {
            console.error(error);

            return json(
                {
                    error:
                        "Failed to process image",

                    details:
                        String(error)
                },
                500
            );
        }
    }
};
