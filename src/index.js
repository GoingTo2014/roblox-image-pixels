const MAX_SIZE = 1024;

// Cloudflare Images binding currently accepts up to 20 MB
// for direct image input.
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

function calculateOutputSize(
    sourceWidth,
    sourceHeight,
    maxSize
) {
    const scale =
        Math.min(
            1,
            maxSize / sourceWidth,
            maxSize / sourceHeight
        );

    const width =
        Math.max(
            1,
            Math.floor(
                sourceWidth * scale
            )
        );

    const height =
        Math.max(
            1,
            Math.floor(
                sourceHeight * scale
            )
        );

    return {
        width,
        height
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

                outputFormat:
                    "raw-rgba",

                supportedImages:
                    [
                        "PNG",
                        "JPEG",
                        "WebP",
                        "GIF",
                        "SVG",
                        "HEIC"
                    ],

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
             * Make sure the Images binding exists.
             */
            if (
                !env.IMAGES ||
                typeof env.IMAGES.input !==
                    "function"
            ) {
                return json(
                    {
                        error:
                            "Cloudflare Images binding is not configured",

                        details:
                            "Add an images binding named IMAGES to wrangler.jsonc"
                    },
                    500
                );
            }

            /*
             * Parse JSON request.
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

            /*
             * Only HTTPS sources.
             */
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
             * Requested size.
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
             * Fetch the original image.
             *
             * We intentionally do NOT read the entire
             * image into an ArrayBuffer here.
             *
             * It gets streamed directly into the
             * Cloudflare Images binding.
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
             * Check Content-Length when available.
             *
             * This prevents obviously oversized inputs
             * from entering the Images binding.
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
             * We need the original dimensions so Roblox
             * knows exactly how large the resulting buffer is.
             *
             * Clone the response so one stream is used for
             * metadata and the other is sent to the transform.
             */
            let originalInfo;

            try {
                const infoResponse =
                    sourceResponse.clone();

                originalInfo =
                    await env.IMAGES.info(
                        infoResponse.body
                    );

            } catch (error) {
                return json(
                    {
                        error:
                            "Cloudflare could not identify the image",

                        details:
                            String(error)
                    },
                    415
                );
            }

            if (
                !originalInfo ||
                typeof originalInfo.width !==
                    "number" ||
                typeof originalInfo.height !==
                    "number"
            ) {
                return json(
                    {
                        error:
                            "Cloudflare returned invalid image dimensions"
                    },
                    500
                );
            }

            /*
             * Calculate the dimensions that the
             * scale-down transformation will produce.
             */
            const outputSize =
                calculateOutputSize(
                    originalInfo.width,
                    originalInfo.height,
                    maxSize
                );

            const width =
                outputSize.width;

            const height =
                outputSize.height;

            /*
             * Transform the image using Cloudflare Images.
             *
             * Crucially, the output format is "rgba".
             *
             * This means Cloudflare gives us the raw
             * RGBA pixel buffer directly.
             *
             * WebP therefore requires no WebP decoder.
             * PNG requires no PNG decoder.
             * JPEG requires no JPEG decoder.
             *
             * anim:false means an animated WebP/GIF is
             * reduced to its first frame.
             */
            let transformation;

            try {
                transformation =
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
                                "rgba",

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
             * Get the raw RGBA stream.
             */
            let rgbaBuffer;

            try {
                rgbaBuffer =
                    await new Response(
                        transformation.image()
                    ).arrayBuffer();

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

            const pixels =
                new Uint8Array(
                    rgbaBuffer
                );

            /*
             * RGBA = 4 bytes per pixel.
             */
            const expectedBytes =
                width *
                height *
                4;

            /*
             * The calculated dimensions normally match
             * exactly. If they don't, give a useful error
             * instead of sending corrupted data to Roblox.
             */
            if (
                pixels.length !==
                expectedBytes
            ) {
                return json(
                    {
                        error:
                            "Cloudflare returned an unexpected RGBA buffer size",

                        originalWidth:
                            originalInfo.width,

                        originalHeight:
                            originalInfo.height,

                        calculatedWidth:
                            width,

                        calculatedHeight:
                            height,

                        expectedBytes:
                            expectedBytes,

                        actualBytes:
                            pixels.length
                    },
                    500
                );
            }

            /*
             * IMPORTANT:
             *
             * Return raw bytes.
             *
             * We explicitly disable automatic response
             * encoding so Cloudflare does not gzip/brotli
             * the binary pixel data behind our backs.
             */
            return new Response(
                pixels,
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
                            "4",

                        "X-Image-Raw-Bytes":
                            String(
                                pixels.length
                            ),

                        "X-Image-Compression":
                            "none",

                        "X-Image-Format":
                            "rgba"
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
