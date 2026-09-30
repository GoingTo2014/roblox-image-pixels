import { decode } from "@cf-wasm/png/workerd";
import jpeg from "jpeg-js";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIZE_LIMIT = 1024;
const GZIP_LEVEL = 6;

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
                "Content-Type":
                    "application/json"
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

function pngToRGBA(png) {
    const width = png.width;
    const height = png.height;
    const source = png.image;

    const colorType = png.colorType;
    const bitDepth = png.bitDepth;
    const lineSize = png.lineSize;

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
            bitDepth +
            ". Only 8-bit PNGs are currently supported."
        );
    }

    let channels;

    switch (colorType) {
        case 0:
            channels = 1;
            break;

        case 2:
            channels = 3;
            break;

        case 4:
            channels = 2;
            break;

        case 6:
            channels = 4;
            break;

        default:
            throw new Error(
                "Unsupported PNG color type: " +
                colorType
            );
    }

    const expectedLineSize =
        width * channels;

    const actualLineSize =
        lineSize || expectedLineSize;

    if (
        actualLineSize <
        expectedLineSize
    ) {
        throw new Error(
            "PNG line size is too small. " +
            "Expected at least " +
            expectedLineSize +
            ", got " +
            actualLineSize
        );
    }

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
        const sourceRowStart =
            y * actualLineSize;

        const outputRowStart =
            y * width * 4;

        for (
            let x = 0;
            x < width;
            x++
        ) {
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
                rgba[outputIndex] =
                    source[sourceIndex];

                rgba[outputIndex + 1] =
                    source[sourceIndex + 1];

                rgba[outputIndex + 2] =
                    source[sourceIndex + 2];

                rgba[outputIndex + 3] =
                    255;

            } else if (colorType === 4) {
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

function resizePixels(
    rgba,
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

    const rgbaOutput =
        new Uint8Array(
            width *
            height *
            4
        );

    let opaque = true;

    for (
        let y = 0;
        y < height;
        y++
    ) {
        const sourceY =
            Math.min(
                sourceHeight - 1,
                Math.floor(
                    y / scale
                )
            );

        for (
            let x = 0;
            x < width;
            x++
        ) {
            const sourceX =
                Math.min(
                    sourceWidth - 1,
                    Math.floor(
                        x / scale
                    )
                );

            const sourceIndex =
                (
                    sourceY *
                    sourceWidth +
                    sourceX
                ) * 4;

            const outputIndex =
                (
                    y *
                    width +
                    x
                ) * 4;

            rgbaOutput[outputIndex] =
                rgba[sourceIndex];

            rgbaOutput[outputIndex + 1] =
                rgba[sourceIndex + 1];

            rgbaOutput[outputIndex + 2] =
                rgba[sourceIndex + 2];

            rgbaOutput[outputIndex + 3] =
                rgba[sourceIndex + 3];

            if (
                rgba[sourceIndex + 3] !==
                255
            ) {
                opaque = false;
            }
        }
    }

    if (opaque) {
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
            rgbaOutput.length
        ) {
            rgb[outputIndex++] =
                rgbaOutput[sourceIndex++];

            rgb[outputIndex++] =
                rgbaOutput[sourceIndex++];

            rgb[outputIndex++] =
                rgbaOutput[sourceIndex++];

            sourceIndex++;
        }

        return {
            width,
            height,
            channels: 3,
            pixels: rgb
        };
    }

    return {
        width,
        height,
        channels: 4,
        pixels: rgbaOutput
    };
}

async function gzipBytes(bytes) {
    const stream =
        new CompressionStream(
            "gzip"
        );

    const writer =
        stream.writable.getWriter();

    await writer.write(bytes);
    await writer.close();

    const result =
        await new Response(
            stream.readable
        ).arrayBuffer();

    return new Uint8Array(result);
}

export default {
    async fetch(request) {
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

        if (
            request.method ===
            "GET"
        ) {
            return json({
                success: true,
                message:
                    "Roblox image pixel Worker is online!",
                maxSize:
                    MAX_SIZE_LIMIT,
                outputFormat:
                    "gzip-binary"
            });
        }

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
            const body =
                await request.json();

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

            const requestedSize =
                Number(body.maxSize);

            const maxSize =
                Number.isFinite(
                    requestedSize
                )
                    ? Math.max(
                        1,
                        Math.min(
                            MAX_SIZE_LIMIT,
                            Math.floor(
                                requestedSize
                            )
                        )
                    )
                    : MAX_SIZE_LIMIT;

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

            if (
                !imageResponse.ok
            ) {
                return json(
                    {
                        error:
                            "Image request failed: HTTP " +
                            imageResponse.status
                    },
                    400
                );
            }

            const contentType =
                (
                    imageResponse.headers.get(
                        "content-type"
                    ) || ""
                )
                    .split(";")[0]
                    .trim()
                    .toLowerCase();

            const arrayBuffer =
                await imageResponse.arrayBuffer();

            const bytes =
                new Uint8Array(
                    arrayBuffer
                );

            if (bytes.length === 0) {
                return json(
                    {
                        error:
                            "Image response was empty"
                    },
                    400
                );
            }

            if (
                bytes.length >
                MAX_BYTES
            ) {
                return json(
                    {
                        error:
                            "Image is too large",
                        downloadedBytes:
                            bytes.length,
                        maxBytes:
                            MAX_BYTES
                    },
                    413
                );
            }

            const actualPNG =
                isPNG(bytes);

            const actualJPEG =
                isJPEG(bytes);

            let sourceWidth;
            let sourceHeight;
            let rgba;

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
                    return json(
                        {
                            error:
                                "PNG decoding failed",
                            details:
                                String(error),
                            contentType,
                            downloadedBytes:
                                bytes.length
                        },
                        500
                    );
                }
            } else if (actualJPEG) {
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
                    return json(
                        {
                            error:
                                "JPEG decoding failed",
                            details:
                                String(error),
                            contentType,
                            downloadedBytes:
                                bytes.length
                        },
                        500
                    );
                }
            } else {
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

                return json(
                    {
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
                    },
                    415
                );
            }

            if (
                !sourceWidth ||
                !sourceHeight ||
                !rgba
            ) {
                return json(
                    {
                        error:
                            "Decoder returned invalid image data"
                    },
                    500
                );
            }

            const expectedRGBABytes =
                sourceWidth *
                sourceHeight *
                4;

            if (
                rgba.length !==
                expectedRGBABytes
            ) {
                return json(
                    {
                        error:
                            "RGBA conversion produced an invalid size",
                        expectedBytes:
                            expectedRGBABytes,
                        actualBytes:
                            rgba.length
                    },
                    500
                );
            }

            const resized =
                resizePixels(
                    rgba,
                    sourceWidth,
                    sourceHeight,
                    maxSize
                );

            const rawBytes =
                resized.pixels.length;

            const compressed =
                await gzipBytes(
                    resized.pixels
                );

            return new Response(
                compressed,
                {
                    status: 200,

                    headers: {
                        ...CORS_HEADERS,

                        "Content-Type":
                            "application/octet-stream",

                        "Content-Encoding":
                            "gzip",

                        "Cache-Control":
                            "no-store",

                        "X-Image-Width":
                            String(
                                resized.width
                            ),

                        "X-Image-Height":
                            String(
                                resized.height
                            ),

                        "X-Image-Channels":
                            String(
                                resized.channels
                            ),

                        "X-Image-Raw-Bytes":
                            String(
                                rawBytes
                            ),

                        "X-Image-Compressed-Bytes":
                            String(
                                compressed.length
                            ),

                        "X-Image-Compression":
                            "gzip"
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
