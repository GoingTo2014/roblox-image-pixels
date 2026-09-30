import { decode } from "@cf-wasm/png/workerd";

const MAX_SIZE = 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

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
     * RGBA PNG.
     *
     * This is the fastest path because the decoder's
     * pixel buffer is already RGBA8.
     */
    if (colorType === 6) {
        const expected =
            width *
            height *
            4;

        if (source.length !== expected) {
            throw new Error(
                "RGBA PNG pixel data has an invalid size. " +
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
     * RGB PNG -> RGBA.
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
     * Grayscale PNG -> RGBA.
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
     * Grayscale + alpha PNG -> RGBA.
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

/*
 * Convert fully-opaque RGBA to RGB.
 *
 * This is optional bandwidth optimization.
 */
function rgbaToRGBIfOpaque(
    rgba,
    width,
    height
) {
    let opaque = true;

    /*
     * First determine whether we actually need alpha.
     */
    for (
        let i = 3;
        i < rgba.length;
        i += 4
    ) {
        if (rgba[i] !== 255) {
            opaque = false;
            break;
        }
    }

    if (!opaque) {
        return {
            channels: 4,
            pixels: rgba
        };
    }

    const rgb =
        new Uint8Array(
            width *
            height *
            3
        );

    let sourceIndex = 0;
    let outputIndex = 0;

    while (
        sourceIndex <
        rgba.length
    ) {
        rgb[outputIndex++] =
            rgba[sourceIndex++];

        rgb[outputIndex++] =
            rgba[sourceIndex++];

        rgb[outputIndex++] =
            rgba[sourceIndex++];

        sourceIndex++;
    }

    return {
        channels: 3,
        pixels: rgb
    };
}

export default {
    async fetch(request, env) {
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

                supportedInputs: [
                    "PNG",
                    "JPEG",
                    "WebP",
                    "GIF",
                    "SVG",
                    "HEIC"
                ],

                outputFormat:
                    "raw-rgb-rgba-binary",

                animatedImages:
                    "first-frame-only"
            });
        }

        /*
         * Only POST.
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
             * Verify the Images binding.
             */
            if (
                !env.IMAGES ||
                typeof env.IMAGES.input !==
                    "function"
            ) {
                return json(
                    {
                        error:
                            "Cloudflare Images binding is not configured"
                    },
                    500
                );
            }

            /*
             * Parse request.
             */
            const body =
                await request.json();

            /*
             * Validate URL.
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
             * Requested resolution.
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
             * Download source image.
             */
            const sourceResponse =
                await fetch(
                    imageURL.toString(),
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0",

                            "Accept":
                                "image/png,image/jpeg,image/webp,image/gif,image/*,*/*"
                        }
                    }
                );

            if (
                !sourceResponse.ok
            ) {
                return json(
                    {
                        error:
                            "Image request failed: HTTP " +
                            sourceResponse.status
                    },
                    400
                );
            }

            if (
                !sourceResponse.body
            ) {
                return json(
                    {
                        error:
                            "Image response did not contain a body"
                    },
                    400
                );
            }

            /*
             * Reject obviously huge files before sending them
             * into the Images binding.
             */
            const contentLength =
                Number(
                    sourceResponse.headers.get(
                        "content-length"
                    )
                );

            if (
                Number.isFinite(
                    contentLength
                ) &&
                contentLength >
                    MAX_SOURCE_BYTES
            ) {
                return json(
                    {
                        error:
                            "Source image is too large",

                        downloadedBytes:
                            contentLength,

                        maxBytes:
                            MAX_SOURCE_BYTES
                    },
                    413
                );
            }

            /*
             * Cloudflare performs the resize.
             *
             * WebP/JPEG/PNG/etc. are converted to PNG.
             * Animated images become one still frame.
             *
             * We deliberately DO NOT calculate the resulting
             * dimensions ourselves.
             */
            let transformed;

            try {
                transformed =
                    await env.IMAGES
                        .input(
                            sourceResponse.body
                        )
                        .transform({
                            width:
                                maxSize,

                            height:
                                maxSize,

                            fit:
                                "scale-down"
                        })
                        .output({
                            format:
                                "image/png",

                            anim:
                                false
                        });

            } catch (error) {
                return json(
                    {
                        error:
                            "Cloudflare image transformation failed",

                        details:
                            String(error)
                    },
                    500
                );
            }

            /*
             * Get the actual transformed response.
             */
            let transformedResponse;

            try {
                transformedResponse =
                    transformed.response();

            } catch (error) {
                return json(
                    {
                        error:
                            "Could not create transformed image response",

                        details:
                            String(error)
                    },
                    500
                );
            }

            /*
             * Read the transformed PNG.
             *
             * IMPORTANT:
             *
             * We will determine width/height from this
             * actual PNG instead of predicting them.
             */
            let transformedBuffer;

            try {
                transformedBuffer =
                    await transformedResponse
                        .arrayBuffer();

            } catch (error) {
                return json(
                    {
                        error:
                            "Could not read transformed image",

                        details:
                            String(error)
                    },
                    500
                );
            }

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
                    500
                );
            }

            /*
             * Decode the ACTUAL transformed PNG.
             */
            let png;

            try {
                png =
                    decode(
                        transformedBytes
                    );

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
             * IMPORTANT:
             *
             * These are now the real dimensions produced
             * by Cloudflare.
             *
             * No calculation based on the source image.
             */
            const width =
                png.width;

            const height =
                png.height;

            if (
                !width ||
                !height
            ) {
                return json(
                    {
                        error:
                            "Cloudflare returned invalid transformed dimensions"
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
                            "Transformed image exceeds maximum size",

                        width,
                        height,

                        maxSize:
                            MAX_SIZE
                    },
                    500
                );
            }

            /*
             * Convert the actual PNG to RGBA.
             */
            let decoded;

            try {
                decoded =
                    pngToRGBA(
                        png
                    );

            } catch (error) {
                return json(
                    {
                        error:
                            "PNG pixel conversion failed",

                        details:
                            String(error),

                        width,
                        height,

                        colorType:
                            png.colorType,

                        bitDepth:
                            png.bitDepth,

                        lineSize:
                            png.lineSize,

                        decodedBytes:
                            png.image
                                ? png.image.length
                                : 0
                    },
                    500
                );
            }

            /*
             * Final RGBA validation uses the ACTUAL
             * transformed dimensions.
             */
            const expectedRGBABytes =
                width *
                height *
                4;

            if (
                decoded.pixels.length !==
                expectedRGBABytes
            ) {
                return json(
                    {
                        error:
                            "Unexpected RGBA buffer size",

                        width,
                        height,

                        expectedBytes:
                            expectedRGBABytes,

                        actualBytes:
                            decoded.pixels.length,

                        colorType:
                            png.colorType,

                        bitDepth:
                            png.bitDepth,

                        lineSize:
                            png.lineSize
                    },
                    500
                );
            }

            /*
             * Reduce opaque RGBA to RGB.
             *
             * This saves 25% before the Roblox server's
             * Zstandard compression.
             */
            const optimized =
                rgbaToRGBIfOpaque(
                    decoded.pixels,
                    width,
                    height
                );

            /*
             * Verify final output size.
             */
            const expectedOutputBytes =
                width *
                height *
                optimized.channels;

            if (
                optimized.pixels.length !==
                expectedOutputBytes
            ) {
                return json(
                    {
                        error:
                            "Internal pixel buffer size error",

                        width,
                        height,

                        channels:
                            optimized.channels,

                        expectedBytes:
                            expectedOutputBytes,

                        actualBytes:
                            optimized.pixels.length
                    },
                    500
                );
            }

            /*
             * Return EXACTLY the pixel bytes.
             *
             * No gzip.
             * No Content-Encoding.
             * No JSON pixels.
             * No Base64.
             */
            return new Response(
                optimized.pixels,
                {
                    status: 200,

                    encodeBody:
                        "manual",

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
                                optimized.channels
                            ),

                        "X-Image-Raw-Bytes":
                            String(
                                optimized.pixels.length
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
