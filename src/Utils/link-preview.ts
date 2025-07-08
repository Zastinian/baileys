import axios, { type AxiosRequestConfig } from "axios";
import type { WAMediaUploadFunction, WAUrlInfo } from "../Types";
import type { ILogger } from "./logger";
import { prepareWAMessageMedia } from "./messages";
import { extractImageThumb, getHttpStream } from "./messages-media";

const THUMBNAIL_WIDTH_PX = 192;

/** Fetches an image and generates a thumbnail for it */
const getCompressedJpegThumbnail = async (
  url: string,
  { thumbnailWidth, fetchOpts }: URLGenerationOptions,
) => {
  const stream = await getHttpStream(url, fetchOpts);
  const result = await extractImageThumb(stream, thumbnailWidth);
  return result;
};

export type URLGenerationOptions = {
  thumbnailWidth: number;
  fetchOpts: {
    /** Timeout in ms */
    timeout: number;
    proxyUrl?: string;
    headers?: AxiosRequestConfig<{}>["headers"];
  };
  uploadImage?: WAMediaUploadFunction;
  logger?: ILogger;
};

interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  images: string[];
  siteName?: string;
  type?: string;
}

const extractMetaContent = (html: string, patterns: string[]): string | undefined => {
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, "i");
    const match = html.match(regex);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
};

const decodeHtmlEntities = (text: string): string => {
  const entities: { [key: string]: string } = {
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

const cleanText = (text: string): string => {
  return decodeHtmlEntities(text)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const extractPageMetadata = (html: string, originalUrl: string): LinkPreviewData => {
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

  const images: string[] = [];

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

const resolveUrl = (url: string, baseUrl: string): string => {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
};

const extractUrl = (text: string): string | null => {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
};

const normalizeUrl = (url: string): string => {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return `https://${url}`;
  }
  return url;
};

const handleRedirects = (
  baseURL: string,
  forwardedURL: string,
  retries: number,
  maxRetry: number,
): boolean => {
  if (retries >= maxRetry) {
    return false;
  }

  try {
    const urlObj = new URL(baseURL);
    const forwardedURLObj = new URL(forwardedURL);

    return (
      forwardedURLObj.hostname === urlObj.hostname ||
      forwardedURLObj.hostname === "www." + urlObj.hostname ||
      "www." + forwardedURLObj.hostname === urlObj.hostname
    );
  } catch {
    return false;
  }
};

const getLinkPreview = async (url: string, options: any): Promise<LinkPreviewData | null> => {
  try {
    const response = await axios.get(url, {
      timeout: options.timeout || 3000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
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
  } catch (error) {
    throw new Error(`Failed to fetch URL: ${error.message}`);
  }
};

/**
 * Given a piece of text, checks for any URL present, generates link preview for the same and returns it
 * Return undefined if the fetch failed or no URL was found
 * @param text first matched URL in text
 * @returns the URL info required to generate link preview
 */
export const getUrlInfo = async (
  text: string,
  opts: URLGenerationOptions = {
    thumbnailWidth: THUMBNAIL_WIDTH_PX,
    fetchOpts: { timeout: 3000 },
  },
): Promise<WAUrlInfo | undefined> => {
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
      handleRedirects: (baseURL: string, forwardedURL: string) => {
        const shouldFollow = handleRedirects(baseURL, forwardedURL, retries, maxRetry);
        if (shouldFollow) {
          retries++;
        }
        return shouldFollow;
      },
    });

    if (info?.title) {
      const [image] = info.images;
      const urlInfo: WAUrlInfo = {
        "canonical-url": info.url,
        "matched-text": foundUrl,
        title: info.title,
        description: info.description,
        originalThumbnailUrl: image,
      };

      if (opts.uploadImage && image) {
        try {
          const { imageMessage } = await prepareWAMessageMedia(
            { image: { url: image } },
            {
              upload: opts.uploadImage,
              mediaTypeOverride: "thumbnail-link",
              options: opts.fetchOpts,
            },
          );
          urlInfo.jpegThumbnail = imageMessage?.jpegThumbnail
            ? Buffer.from(imageMessage.jpegThumbnail)
            : undefined;
          urlInfo.highQualityThumbnail = imageMessage || undefined;
        } catch (error) {
          opts.logger?.debug(
            { err: error.stack, url: previewLink },
            "error in uploading thumbnail",
          );
        }
      } else if (image) {
        try {
          const thumbnailResult = await getCompressedJpegThumbnail(image, opts);
          urlInfo.jpegThumbnail = thumbnailResult.buffer;
        } catch (error) {
          opts.logger?.debug(
            { err: error.stack, url: previewLink },
            "error in generating thumbnail",
          );
        }
      }

      return urlInfo;
    }
  } catch (error) {
    if (!error.message.includes("receive a valid")) {
      throw error;
    }
  }

  return undefined;
};
