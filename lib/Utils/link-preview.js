"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUrlInfo = void 0;
const axios_1 = __importDefault(require("axios"));
const messages_1 = require("./messages");
const messages_media_1 = require("./messages-media");
const THUMBNAIL_WIDTH_PX = 192;
/** Fetches an image and generates a thumbnail for it */
const getCompressedJpegThumbnail = async (url, { thumbnailWidth, fetchOpts }) => {
    const stream = await (0, messages_media_1.getHttpStream)(url, fetchOpts);
    const result = await (0, messages_media_1.extractImageThumb)(stream, thumbnailWidth);
    return result;
};
const extractMetaContent = (html, patterns) => {
    for (const pattern of patterns) {
        const regex = new RegExp(pattern, "i");
        const match = html.match(regex);
        if (match === null || match === void 0 ? void 0 : match[1]) {
            return match[1].trim();
        }
    }
    return undefined;
};
const decodeHtmlEntities = (text) => {
    const entities = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&#39;": "'",
        "&apos;": "'",
        "&#x27;": "'",
        "&#x2F;": "/",
        "&#x60;": "`",
        "&#x3D;": "=",
    };
    return text.replace(/&[#\w]+;/g, (entity) => {
        return entities[entity] || entity;
    });
};
const cleanText = (text) => {
    return decodeHtmlEntities(text)
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
};
const extractPageMetadata = (html, originalUrl) => {
    const titlePatterns = [
        "<meta[^>]*property=[\"']og:title[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*property=[\"']og:title[\"']",
        "<meta[^>]*name=[\"']twitter:title[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*name=[\"']twitter:title[\"']",
        "<meta[^>]*name=[\"']title[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*name=[\"']title[\"']",
        "<title[^>]*>([^<]*)</title>",
    ];
    const title = extractMetaContent(html, titlePatterns);
    const descriptionPatterns = [
        "<meta[^>]*property=[\"']og:description[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*property=[\"']og:description[\"']",
        "<meta[^>]*name=[\"']twitter:description[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*name=[\"']twitter:description[\"']",
        "<meta[^>]*name=[\"']description[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*name=[\"']description[\"']",
    ];
    const description = extractMetaContent(html, descriptionPatterns);
    const images = [];
    // Open Graph image
    const ogImagePatterns = [
        "<meta[^>]*property=[\"']og:image[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*property=[\"']og:image[\"']",
    ];
    const ogImage = extractMetaContent(html, ogImagePatterns);
    if (ogImage) {
        images.push(resolveUrl(ogImage, originalUrl));
    }
    // Twitter image
    const twitterImagePatterns = [
        "<meta[^>]*name=[\"']twitter:image[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*name=[\"']twitter:image[\"']",
        "<meta[^>]*name=[\"']twitter:image:src[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*name=[\"']twitter:image:src[\"']",
    ];
    const twitterImage = extractMetaContent(html, twitterImagePatterns);
    if (twitterImage && !images.includes(twitterImage)) {
        images.push(resolveUrl(twitterImage, originalUrl));
    }
    const faviconPatterns = [
        "<link[^>]*rel=[\"']icon[\"'][^>]*href=[\"']([^\"']*)[\"']",
        "<link[^>]*href=[\"']([^\"']*)[\"'][^>]*rel=[\"']icon[\"']",
        "<link[^>]*rel=[\"']shortcut icon[\"'][^>]*href=[\"']([^\"']*)[\"']",
        "<link[^>]*href=[\"']([^\"']*)[\"'][^>]*rel=[\"']shortcut icon[\"']",
        "<link[^>]*rel=[\"']apple-touch-icon[\"'][^>]*href=[\"']([^\"']*)[\"']",
        "<link[^>]*href=[\"']([^\"']*)[\"'][^>]*rel=[\"']apple-touch-icon[\"']",
    ];
    if (images.length === 0) {
        const favicon = extractMetaContent(html, faviconPatterns);
        if (favicon) {
            images.push(resolveUrl(favicon, originalUrl));
        }
    }
    const siteNamePatterns = [
        "<meta[^>]*property=[\"']og:site_name[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*property=[\"']og:site_name[\"']",
        "<meta[^>]*name=[\"']application-name[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*name=[\"']application-name[\"']",
    ];
    const siteName = extractMetaContent(html, siteNamePatterns);
    const typePatterns = [
        "<meta[^>]*property=[\"']og:type[\"'][^>]*content=[\"']([^\"']*)[\"']",
        "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*property=[\"']og:type[\"']",
    ];
    const type = extractMetaContent(html, typePatterns) || "website";
    return {
        url: originalUrl,
        title: title ? cleanText(title) : undefined,
        description: description ? cleanText(description) : undefined,
        images,
        siteName: siteName ? cleanText(siteName) : undefined,
        type,
    };
};
const resolveUrl = (url, baseUrl) => {
    try {
        return new URL(url, baseUrl).href;
    }
    catch (_a) {
        return url;
    }
};
const extractUrl = (text) => {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const match = text.match(urlRegex);
    return match ? match[0] : null;
};
const normalizeUrl = (url) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return `https://${url}`;
    }
    return url;
};
const handleRedirects = (baseURL, forwardedURL, retries, maxRetry) => {
    if (retries >= maxRetry) {
        return false;
    }
    try {
        const urlObj = new URL(baseURL);
        const forwardedURLObj = new URL(forwardedURL);
        return (forwardedURLObj.hostname === urlObj.hostname ||
            forwardedURLObj.hostname === "www." + urlObj.hostname ||
            "www." + forwardedURLObj.hostname === urlObj.hostname);
    }
    catch (_a) {
        return false;
    }
};
const getLinkPreview = async (url, options) => {
    try {
        const response = await axios_1.default.get(url, {
            timeout: options.timeout || 3000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                ...options.headers,
            },
            maxRedirects: 5,
            validateStatus: (status) => status < 400,
        });
        const contentType = response.headers["content-type"] || "";
        if (!contentType.includes("text/html")) {
            return null;
        }
        return extractPageMetadata(response.data, url);
    }
    catch (error) {
        throw new Error(`Failed to fetch URL: ${error.message}`);
    }
};
/**
 * Given a piece of text, checks for any URL present, generates link preview for the same and returns it
 * Return undefined if the fetch failed or no URL was found
 * @param text first matched URL in text
 * @returns the URL info required to generate link preview
 */
const getUrlInfo = async (text, opts = {
    thumbnailWidth: THUMBNAIL_WIDTH_PX,
    fetchOpts: { timeout: 3000 },
}) => {
    var _a, _b;
    try {
        const foundUrl = extractUrl(text);
        if (!foundUrl) {
            return undefined;
        }
        let retries = 0;
        const maxRetry = 5;
        const previewLink = normalizeUrl(foundUrl);
        const info = await getLinkPreview(previewLink, {
            ...opts.fetchOpts,
            followRedirects: "follow",
            handleRedirects: (baseURL, forwardedURL) => {
                const shouldFollow = handleRedirects(baseURL, forwardedURL, retries, maxRetry);
                if (shouldFollow) {
                    retries++;
                }
                return shouldFollow;
            },
        });
        if (info === null || info === void 0 ? void 0 : info.title) {
            const [image] = info.images;
            const urlInfo = {
                "canonical-url": info.url,
                "matched-text": foundUrl,
                title: info.title,
                description: info.description,
                originalThumbnailUrl: image,
            };
            if (opts.uploadImage && image) {
                try {
                    const { imageMessage } = await (0, messages_1.prepareWAMessageMedia)({ image: { url: image } }, {
                        upload: opts.uploadImage,
                        mediaTypeOverride: "thumbnail-link",
                        options: opts.fetchOpts,
                    });
                    urlInfo.jpegThumbnail = (imageMessage === null || imageMessage === void 0 ? void 0 : imageMessage.jpegThumbnail)
                        ? Buffer.from(imageMessage.jpegThumbnail)
                        : undefined;
                    urlInfo.highQualityThumbnail = imageMessage || undefined;
                }
                catch (error) {
                    (_a = opts.logger) === null || _a === void 0 ? void 0 : _a.debug({ err: error.stack, url: previewLink }, "error in uploading thumbnail");
                }
            }
            else if (image) {
                try {
                    const thumbnailResult = await getCompressedJpegThumbnail(image, opts);
                    urlInfo.jpegThumbnail = thumbnailResult.buffer;
                }
                catch (error) {
                    (_b = opts.logger) === null || _b === void 0 ? void 0 : _b.debug({ err: error.stack, url: previewLink }, "error in generating thumbnail");
                }
            }
            return urlInfo;
        }
    }
    catch (error) {
        if (!error.message.includes("receive a valid")) {
            throw error;
        }
    }
    return undefined;
};
exports.getUrlInfo = getUrlInfo;
