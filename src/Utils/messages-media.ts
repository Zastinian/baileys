import * as Crypto from "node:crypto";
import { Boom } from "@hapi/boom";
import axios, { type AxiosRequestConfig } from "axios";
import { exec } from "child_process";
import { once } from "events";
import { createReadStream, createWriteStream, promises as fs, type WriteStream } from "fs";
import { ResizeStrategy } from "jimp";
import { tmpdir } from "os";
import { join } from "path";
import { Readable, Transform } from "stream";
import type { URL } from "url";
import { promisify } from "util";
import { proto } from "../../WAProto";
import { DEFAULT_ORIGIN, MEDIA_HKDF_KEY_MAPPING, MEDIA_PATH_MAP } from "../Defaults";
import type {
  BaileysEventMap,
  DownloadableMessage,
  MediaConnInfo,
  MediaDecryptionKeyInfo,
  MediaType,
  MessageType,
  SocketConfig,
  WAGenericMediaMessage,
  WAMediaUpload,
  WAMediaUploadFunction,
  WAMessageContent,
} from "../Types";
import {
  type BinaryNode,
  getBinaryNodeChild,
  getBinaryNodeChildBuffer,
  jidNormalizedUser,
} from "../WABinary";
import { aesDecryptGCM, aesEncryptGCM, hkdf } from "./crypto";
import { generateMessageIDV2 } from "./generics";
import type { ILogger } from "./logger";

const execAsync = promisify(exec);

const getTmpFilesDirectory = () => tmpdir();

const getImageProcessingLibrary = async () => {
  const [jimp] = await Promise.all([import("jimp").catch(() => {})]);

  if (jimp) {
    return { jimp };
  }

  throw new Boom("No image processing library available");
};

export const hkdfInfoKey = (type: MediaType) => {
  const hkdfInfo = MEDIA_HKDF_KEY_MAPPING[type];
  return `WhatsApp ${hkdfInfo} Keys`;
};

export const getRawMediaUploadData = async (
  media: WAMediaUpload,
  mediaType: MediaType,
  logger?: ILogger,
) => {
  const { stream } = await getStream(media);
  logger?.debug("got stream for raw upload");

  const hasher = Crypto.createHash("sha256");
  const filePath = join(tmpdir(), mediaType + generateMessageIDV2());
  const fileWriteStream = createWriteStream(filePath);

  let fileLength = 0;
  try {
    for await (const data of stream) {
      fileLength += data.length;
      hasher.update(data);
      if (!fileWriteStream.write(data)) {
        await once(fileWriteStream, "drain");
      }
    }

    fileWriteStream.end();
    await once(fileWriteStream, "finish");
    stream.destroy();
    const fileSha256 = hasher.digest();
    logger?.debug("hashed data for raw upload");
    return {
      filePath: filePath,
      fileSha256,
      fileLength,
    };
  } catch (error) {
    fileWriteStream.destroy();
    stream.destroy();
    try {
      await fs.unlink(filePath);
    } catch {
      //
    }

    throw error;
  }
};

/** generates all the keys required to encrypt/decrypt & sign a media message */
export async function getMediaKeys(
  buffer: Uint8Array | string | null | undefined,
  mediaType: MediaType,
): Promise<MediaDecryptionKeyInfo> {
  if (!buffer) {
    throw new Boom("Cannot derive from empty media key");
  }

  if (typeof buffer === "string") {
    buffer = Buffer.from(buffer.replace("data:;base64,", ""), "base64");
  }

  // expand using HKDF to 112 bytes, also pass in the relevant app info
  const expandedMediaKey = await hkdf(buffer, 112, { info: hkdfInfoKey(mediaType) });
  return {
    iv: expandedMediaKey.slice(0, 16),
    cipherKey: expandedMediaKey.slice(16, 48),
    macKey: expandedMediaKey.slice(48, 80),
  };
}

/** Extracts video thumb using FFMPEG */
const extractVideoThumb = async (
  path: string,
  destPath: string,
  time: string,
  size: { width: number; height: number },
) =>
  new Promise<void>((resolve, reject) => {
    const cmd = `ffmpeg -ss ${time} -i ${path} -y -vf scale=${size.width}:-1 -vframes 1 -f image2 ${destPath}`;
    exec(cmd, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

export const extractImageThumb = async (
  bufferOrFilePath: Readable | Buffer | string,
  width = 32,
) => {
  if (bufferOrFilePath instanceof Readable) {
    bufferOrFilePath = await toBuffer(bufferOrFilePath);
  }

  const lib = await getImageProcessingLibrary();
  if ("jimp" in lib && typeof lib.jimp?.Jimp === "object") {
    const jimp = await lib.jimp.default.Jimp.read(bufferOrFilePath);
    const dimensions = {
      width: jimp.width,
      height: jimp.height,
    };
    const buffer = await jimp
      .resize({ w: width, mode: ResizeStrategy.BILINEAR })
      .getBuffer("image/jpeg", { quality: 50 });
    return {
      buffer,
      original: dimensions,
    };
  } else {
    throw new Boom("No image processing library available");
  }
};

export const encodeBase64EncodedStringForUpload = (b64: string) =>
  encodeURIComponent(b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/\=+$/, ""));

export const generateProfilePicture = async (
  mediaUpload: WAMediaUpload,
  dimensions?: { width: number; height: number },
) => {
  let buffer: Buffer;

  const { width: w = 640, height: h = 640 } = dimensions || {};

  if (Buffer.isBuffer(mediaUpload)) {
    buffer = mediaUpload;
  } else {
    // Use getStream to handle all WAMediaUpload types (Buffer, Stream, URL)
    const { stream } = await getStream(mediaUpload);
    // Convert the resulting stream to a buffer
    buffer = await toBuffer(stream);
  }

  const lib = await getImageProcessingLibrary();
  let img: Promise<Buffer>;
  if ("jimp" in lib && typeof lib.jimp?.Jimp === "object") {
    const jimp = await lib.jimp.default.Jimp.read(buffer);
    const min = Math.min(jimp.width, jimp.height);
    const cropped = jimp.crop({ x: 0, y: 0, w: min, h: min });

    img = cropped
      .resize({ w, h, mode: ResizeStrategy.BILINEAR })
      .getBuffer("image/jpeg", { quality: 50 });
  } else {
    throw new Boom("No image processing library available");
  }

  return {
    img: await img,
  };
};

/** gets the SHA256 of the given media message */
export const mediaMessageSHA256B64 = (message: WAMessageContent) => {
  const media = Object.values(message)[0] as WAGenericMediaMessage;
  return media?.fileSha256 && Buffer.from(media.fileSha256).toString("base64");
};

/**
 * Get audio duration using ffprobe (part of ffmpeg)
 * This replaces the music-metadata dependency
 */
export async function getAudioDuration(
  buffer: Buffer | string | Readable,
): Promise<number | undefined> {
  try {
    let filePath: string;
    let shouldCleanup = false;

    if (Buffer.isBuffer(buffer)) {
      // Write buffer to temporary file
      filePath = join(getTmpFilesDirectory(), "audio_" + generateMessageIDV2());
      await fs.writeFile(filePath, buffer);
      shouldCleanup = true;
    } else if (typeof buffer === "string") {
      // It's already a file path
      filePath = buffer;
    } else {
      // It's a readable stream, convert to buffer first
      const audioBuffer = await toBuffer(buffer);
      filePath = join(getTmpFilesDirectory(), "audio_" + generateMessageIDV2());
      await fs.writeFile(filePath, audioBuffer);
      shouldCleanup = true;
    }

    try {
      // Use ffprobe to get audio duration
      const { stdout } = await execAsync(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
      );

      const duration = parseFloat(stdout.trim());
      return isNaN(duration) ? undefined : duration;
    } finally {
      // Clean up temporary file if we created one
      if (shouldCleanup) {
        try {
          await fs.unlink(filePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  } catch (error) {
    // If ffprobe fails, return undefined
    return undefined;
  }
}

/**
 * Parse basic audio metadata from common formats
 * This is a simplified version that reads basic info from headers
 */
const parseAudioMetadata = (buffer: Buffer) => {
  // MP3 header detection
  if (buffer.length > 10 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    // This is an MP3 file
    // For a more complete implementation, you'd parse the MP3 frame headers
    // This is a basic example that doesn't extract actual duration
    return { format: "mp3" };
  }

  // OGG header detection
  if (buffer.length > 4 && buffer.toString("ascii", 0, 4) === "OggS") {
    return { format: "ogg" };
  }

  // WAV header detection
  if (
    buffer.length > 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  ) {
    return { format: "wav" };
  }

  // M4A/AAC header detection
  if (buffer.length > 8 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return { format: "m4a" };
  }

  return { format: "unknown" };
};

/**
 * Get audio duration using FFmpeg as fallback
 * This is more reliable than parsing headers manually
 */
export async function getAudioDurationFallback(
  buffer: Buffer | string | Readable,
): Promise<number | undefined> {
  try {
    // First try with ffprobe
    const duration = await getAudioDuration(buffer);
    if (duration !== undefined) {
      return duration;
    }

    // If that fails, try basic header parsing (limited functionality)
    if (Buffer.isBuffer(buffer)) {
      const metadata = parseAudioMetadata(buffer);
      // For now, we can't extract duration from headers without more complex parsing
      // This would require implementing parsers for each audio format
      return undefined;
    }

    return undefined;
  } catch (error) {
    return undefined;
  }
}

interface WAVFormat {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

interface WAVData {
  offset: number;
  size: number;
}

function decodeWAV(buffer: Buffer): { sampleRate: number; channelData: Float32Array } {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid WAV file");
  }

  let offset = 12;
  let fmtChunk: WAVFormat | null = null;
  let dataChunk: WAVData | null = null;

  while (offset < buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      fmtChunk = {
        audioFormat: buffer.readUInt16LE(offset + 8),
        numChannels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22),
      };
    } else if (chunkId === "data") {
      dataChunk = {
        offset: offset + 8,
        size: chunkSize,
      };
      break;
    }

    offset += 8 + chunkSize;
  }

  if (!fmtChunk || !dataChunk) {
    throw new Error("Invalid WAV format: missing chunks");
  }

  if (fmtChunk.audioFormat !== 1) {
    throw new Error("Only PCM format supported");
  }

  const bytesPerSample = fmtChunk.bitsPerSample / 8;
  const numSamples = dataChunk.size / (bytesPerSample * fmtChunk.numChannels);
  const channelData = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const sampleOffset = dataChunk.offset + i * bytesPerSample * fmtChunk.numChannels;

    let sample = 0;
    if (fmtChunk.bitsPerSample === 16) {
      sample = buffer.readInt16LE(sampleOffset) / 32768.0;
    } else if (fmtChunk.bitsPerSample === 8) {
      sample = (buffer.readUInt8(sampleOffset) - 128) / 128.0;
    } else if (fmtChunk.bitsPerSample === 24) {
      const byte1 = buffer.readUInt8(sampleOffset);
      const byte2 = buffer.readUInt8(sampleOffset + 1);
      const byte3 = buffer.readUInt8(sampleOffset + 2);
      sample = ((byte3 << 24) | (byte2 << 16) | (byte1 << 8)) / 2147483648.0;
    } else if (fmtChunk.bitsPerSample === 32) {
      sample = buffer.readInt32LE(sampleOffset) / 2147483648.0;
    }

    channelData[i] = sample;
  }

  return {
    sampleRate: fmtChunk.sampleRate,
    channelData,
  };
}

function detectAudioFormat(buffer: Buffer): "wav" | "mp3" | "unknown" {
  if (buffer.length < 12) return "unknown";

  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") {
    return "wav";
  }

  if (
    buffer.toString("ascii", 0, 3) === "ID3" ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    return "mp3";
  }

  return "unknown";
}

function extractMP3Samples(buffer: Buffer): Float32Array {
  const samples: number[] = [];
  let offset = 0;

  while (offset < buffer.length - 4) {
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const frameSize = 144 + Math.floor(Math.random() * 300);

      let sum = 0;
      let count = 0;
      for (let i = offset + 4; i < Math.min(offset + frameSize, buffer.length); i++) {
        sum += Math.abs(buffer[i] - 128);
        count++;
      }

      if (count > 0) {
        samples.push(sum / count / 128.0);
      }

      offset += frameSize;
    } else {
      offset++;
    }
  }

  if (samples.length === 0) {
    for (let i = 0; i < Math.min(buffer.length, 44100); i++) {
      samples.push((buffer[i] - 128) / 128.0);
    }
  }

  return new Float32Array(samples);
}

export async function getAudioWaveform(buffer: Buffer | string | Readable, logger?: ILogger) {
  try {
    let audioData: Buffer;

    if (Buffer.isBuffer(buffer)) {
      audioData = buffer;
    } else if (typeof buffer === "string") {
      const rStream = createReadStream(buffer);
      audioData = await toBuffer(rStream);
    } else {
      audioData = await toBuffer(buffer);
    }

    const format = detectAudioFormat(audioData);

    let rawData: Float32Array;

    if (format === "wav") {
      const decoded = decodeWAV(audioData);
      rawData = decoded.channelData;
    } else if (format === "mp3") {
      rawData = extractMP3Samples(audioData);
    } else {
      throw new Error("Unsupported audio format. Only WAV and basic MP3 supported.");
    }

    const samples = 64;
    const blockSize = Math.floor(rawData.length / samples);
    const filteredData: number[] = [];

    for (let i = 0; i < samples; i++) {
      const blockStart = blockSize * i;
      let sum = 0;

      for (let j = 0; j < blockSize; j++) {
        if (blockStart + j < rawData.length) {
          sum += Math.abs(rawData[blockStart + j]);
        }
      }

      filteredData.push(sum / blockSize);
    }

    const maxValue = Math.max(...filteredData);
    const multiplier = maxValue > 0 ? Math.pow(maxValue, -1) : 1;
    const normalizedData = filteredData.map((n) => n * multiplier);

    const waveform = new Uint8Array(normalizedData.map((n) => Math.floor(100 * n)));

    return waveform;
  } catch (e) {
    logger?.debug("Failed to generate waveform: " + e);
    throw e;
  }
}

export const toReadable = (buffer: Buffer) => {
  const readable = new Readable({ read: () => {} });
  readable.push(buffer);
  readable.push(null);
  return readable;
};

export const toBuffer = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  stream.destroy();
  return Buffer.concat(chunks);
};

export const getStream = async (item: WAMediaUpload, opts?: AxiosRequestConfig) => {
  if (Buffer.isBuffer(item)) {
    return { stream: toReadable(item), type: "buffer" } as const;
  }

  if ("stream" in item) {
    return { stream: item.stream, type: "readable" } as const;
  }

  const urlStr = item.url.toString();

  if (urlStr.startsWith("data:")) {
    const buffer = Buffer.from(urlStr.split(",")[1], "base64");
    return { stream: toReadable(buffer), type: "buffer" } as const;
  }

  if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
    return { stream: await getHttpStream(item.url, opts), type: "remote" } as const;
  }

  return { stream: createReadStream(item.url), type: "file" } as const;
};

/** generates a thumbnail for a given media, if required */
export async function generateThumbnail(
  file: string,
  mediaType: "video" | "image",
  options: {
    logger?: ILogger;
  },
) {
  let thumbnail: string | undefined;
  let originalImageDimensions: { width: number; height: number } | undefined;
  if (mediaType === "image") {
    const { buffer, original } = await extractImageThumb(file);
    thumbnail = buffer.toString("base64");
    if (original.width && original.height) {
      originalImageDimensions = {
        width: original.width,
        height: original.height,
      };
    }
  } else if (mediaType === "video") {
    const imgFilename = join(getTmpFilesDirectory(), generateMessageIDV2() + ".jpg");
    try {
      await extractVideoThumb(file, imgFilename, "00:00:00", { width: 32, height: 32 });
      const buff = await fs.readFile(imgFilename);
      thumbnail = buff.toString("base64");

      await fs.unlink(imgFilename);
    } catch (err) {
      options.logger?.debug("could not generate video thumb: " + err);
    }
  }

  return {
    thumbnail,
    originalImageDimensions,
  };
}

export const getHttpStream = async (
  url: string | URL,
  options: AxiosRequestConfig & { isStream?: true } = {},
) => {
  const fetched = await axios.get(url.toString(), { ...options, responseType: "stream" });
  return fetched.data as Readable;
};

type EncryptedStreamOptions = {
  saveOriginalFileIfRequired?: boolean;
  logger?: ILogger;
  opts?: AxiosRequestConfig;
};

export const encryptedStream = async (
  media: WAMediaUpload,
  mediaType: MediaType,
  { logger, saveOriginalFileIfRequired, opts }: EncryptedStreamOptions = {},
) => {
  const { stream, type } = await getStream(media, opts);

  logger?.debug("fetched media stream");

  const mediaKey = Crypto.randomBytes(32);
  const { cipherKey, iv, macKey } = await getMediaKeys(mediaKey, mediaType);

  const encFilePath = join(getTmpFilesDirectory(), mediaType + generateMessageIDV2() + "-enc");
  const encFileWriteStream = createWriteStream(encFilePath);

  let originalFileStream: WriteStream | undefined;
  let originalFilePath: string | undefined;

  if (saveOriginalFileIfRequired) {
    originalFilePath = join(
      getTmpFilesDirectory(),
      mediaType + generateMessageIDV2() + "-original",
    );
    originalFileStream = createWriteStream(originalFilePath);
  }

  let fileLength = 0;
  const aes = Crypto.createCipheriv("aes-256-cbc", cipherKey, iv);
  const hmac = Crypto.createHmac("sha256", macKey!).update(iv);
  const sha256Plain = Crypto.createHash("sha256");
  const sha256Enc = Crypto.createHash("sha256");

  const onChunk = (buff: Buffer) => {
    sha256Enc.update(buff);
    hmac.update(buff);
    encFileWriteStream.write(buff);
  };

  try {
    for await (const data of stream) {
      fileLength += data.length;

      if (
        type === "remote" &&
        opts?.maxContentLength &&
        fileLength + data.length > opts.maxContentLength
      ) {
        throw new Boom(`content length exceeded when encrypting "${type}"`, {
          data: { media, type },
        });
      }

      if (originalFileStream) {
        if (!originalFileStream.write(data)) {
          await once(originalFileStream, "drain");
        }
      }

      sha256Plain.update(data);
      onChunk(aes.update(data));
    }

    onChunk(aes.final());

    const mac = hmac.digest().slice(0, 10);
    sha256Enc.update(mac);

    const fileSha256 = sha256Plain.digest();
    const fileEncSha256 = sha256Enc.digest();

    encFileWriteStream.write(mac);

    encFileWriteStream.end();
    originalFileStream?.end?.();
    stream.destroy();

    logger?.debug("encrypted data successfully");

    return {
      mediaKey,
      originalFilePath,
      encFilePath,
      mac,
      fileEncSha256,
      fileSha256,
      fileLength,
    };
  } catch (error) {
    // destroy all streams with error
    encFileWriteStream.destroy();
    originalFileStream?.destroy?.();
    aes.destroy();
    hmac.destroy();
    sha256Plain.destroy();
    sha256Enc.destroy();
    stream.destroy();

    try {
      await fs.unlink(encFilePath);
      if (originalFilePath) {
        await fs.unlink(originalFilePath);
      }
    } catch (err) {
      logger?.error({ err }, "failed deleting tmp files");
    }

    throw error;
  }
};

const DEF_HOST = "mmg.whatsapp.net";
const AES_CHUNK_SIZE = 16;

const toSmallestChunkSize = (num: number) => {
  return Math.floor(num / AES_CHUNK_SIZE) * AES_CHUNK_SIZE;
};

export type MediaDownloadOptions = {
  startByte?: number;
  endByte?: number;
  options?: AxiosRequestConfig<{}>;
};

export const getUrlFromDirectPath = (directPath: string) => `https://${DEF_HOST}${directPath}`;

export const downloadContentFromMessage = async (
  { mediaKey, directPath, url }: DownloadableMessage,
  type: MediaType,
  opts: MediaDownloadOptions = {},
) => {
  const isValidMediaUrl = url?.startsWith("https://mmg.whatsapp.net/");
  const downloadUrl = isValidMediaUrl ? url : getUrlFromDirectPath(directPath!);
  if (!downloadUrl) {
    throw new Boom("No valid media URL or directPath present in message", { statusCode: 400 });
  }

  const keys = await getMediaKeys(mediaKey, type);

  return downloadEncryptedContent(downloadUrl, keys, opts);
};

/**
 * Decrypts and downloads an AES256-CBC encrypted file given the keys.
 * Assumes the SHA256 of the plaintext is appended to the end of the ciphertext
 * */
export const downloadEncryptedContent = async (
  downloadUrl: string,
  { cipherKey, iv }: MediaDecryptionKeyInfo,
  { startByte, endByte, options }: MediaDownloadOptions = {},
) => {
  let bytesFetched = 0;
  let startChunk = 0;
  let firstBlockIsIV = false;
  // if a start byte is specified -- then we need to fetch the previous chunk as that will form the IV
  if (startByte) {
    const chunk = toSmallestChunkSize(startByte || 0);
    if (chunk) {
      startChunk = chunk - AES_CHUNK_SIZE;
      bytesFetched = chunk;

      firstBlockIsIV = true;
    }
  }

  const endChunk = endByte ? toSmallestChunkSize(endByte || 0) + AES_CHUNK_SIZE : undefined;

  const headers: AxiosRequestConfig["headers"] = {
    ...(options?.headers || {}),
    Origin: DEFAULT_ORIGIN,
  };
  if (startChunk || endChunk) {
    headers.Range = `bytes=${startChunk}-`;
    if (endChunk) {
      headers.Range += endChunk;
    }
  }

  // download the message
  const fetched = await getHttpStream(downloadUrl, {
    ...(options || {}),
    headers,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  let remainingBytes = Buffer.from([]);

  let aes: Crypto.Decipheriv;

  const pushBytes = (bytes: Buffer, push: (bytes: Buffer) => void) => {
    if (startByte || endByte) {
      const start = bytesFetched >= startByte! ? undefined : Math.max(startByte! - bytesFetched, 0);
      const end =
        bytesFetched + bytes.length < endByte! ? undefined : Math.max(endByte! - bytesFetched, 0);

      push(bytes.slice(start, end));

      bytesFetched += bytes.length;
    } else {
      push(bytes);
    }
  };

  const output = new Transform({
    transform(chunk, _, callback) {
      let data = Buffer.concat([remainingBytes, chunk]);

      const decryptLength = toSmallestChunkSize(data.length);
      remainingBytes = data.slice(decryptLength);
      data = data.slice(0, decryptLength);

      if (!aes) {
        let ivValue = iv;
        if (firstBlockIsIV) {
          ivValue = data.slice(0, AES_CHUNK_SIZE);
          data = data.slice(AES_CHUNK_SIZE);
        }

        aes = Crypto.createDecipheriv("aes-256-cbc", cipherKey, ivValue);
        // if an end byte that is not EOF is specified
        // stop auto padding (PKCS7) -- otherwise throws an error for decryption
        if (endByte) {
          aes.setAutoPadding(false);
        }
      }

      try {
        pushBytes(aes.update(data), (b) => this.push(b));
        callback();
      } catch (error) {
        callback(error);
      }
    },
    final(callback) {
      try {
        pushBytes(aes.final(), (b) => this.push(b));
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
  return fetched.pipe(output, { end: true });
};

export function extensionForMediaMessage(message: WAMessageContent) {
  const getExtension = (mimetype: string) => mimetype.split(";")[0].split("/")[1];
  const type = Object.keys(message)[0] as MessageType;
  let extension: string;
  if (type === "locationMessage" || type === "liveLocationMessage" || type === "productMessage") {
    extension = ".jpeg";
  } else {
    const messageContent = message[type] as WAGenericMediaMessage;
    extension = getExtension(messageContent.mimetype!);
  }

  return extension;
}

export const getWAUploadToServer = (
  { customUploadHosts, fetchAgent, logger, options }: SocketConfig,
  refreshMediaConn: (force: boolean) => Promise<MediaConnInfo>,
): WAMediaUploadFunction => {
  return async (filePath, { mediaType, fileEncSha256B64, timeoutMs }) => {
    // send a query JSON to obtain the url & auth token to upload our media
    let uploadInfo = await refreshMediaConn(false);

    let urls: { mediaUrl: string; directPath: string } | undefined;
    const hosts = [...customUploadHosts, ...uploadInfo.hosts];

    fileEncSha256B64 = encodeBase64EncodedStringForUpload(fileEncSha256B64);

    for (const { hostname } of hosts) {
      logger.debug(`uploading to "${hostname}"`);

      const auth = encodeURIComponent(uploadInfo.auth); // the auth token
      const url = `https://${hostname}${MEDIA_PATH_MAP[mediaType]}/${fileEncSha256B64}?auth=${auth}&token=${fileEncSha256B64}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: any;
      try {
        const body = await axios.post(url, createReadStream(filePath), {
          ...options,
          maxRedirects: 0,
          headers: {
            ...(options.headers || {}),
            "Content-Type": "application/octet-stream",
            Origin: DEFAULT_ORIGIN,
          },
          httpsAgent: fetchAgent,
          timeout: timeoutMs,
          responseType: "json",
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });
        result = body.data;

        if (result?.url || result?.directPath) {
          urls = {
            mediaUrl: result.url,
            directPath: result.direct_path,
          };
          break;
        } else {
          uploadInfo = await refreshMediaConn(true);
          throw new Error(`upload failed, reason: ${JSON.stringify(result)}`);
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          result = error.response?.data;
        }

        const isLast = hostname === hosts[uploadInfo.hosts.length - 1]?.hostname;
        logger.warn(
          { trace: error.stack, uploadResult: result },
          `Error in uploading to ${hostname} ${isLast ? "" : ", retrying..."}`,
        );
      }
    }

    if (!urls) {
      throw new Boom("Media upload failed on all hosts", { statusCode: 500 });
    }

    return urls;
  };
};

const getMediaRetryKey = (mediaKey: Buffer | Uint8Array) => {
  return hkdf(mediaKey, 32, { info: "WhatsApp Media Retry Notification" });
};

/**
 * Generate a binary node that will request the phone to re-upload the media & return the newly uploaded URL
 */
export const encryptMediaRetryRequest = async (
  key: proto.IMessageKey,
  mediaKey: Buffer | Uint8Array,
  meId: string,
) => {
  const recp: proto.IServerErrorReceipt = { stanzaId: key.id };
  const recpBuffer = proto.ServerErrorReceipt.encode(recp).finish();

  const iv = Crypto.randomBytes(12);
  const retryKey = await getMediaRetryKey(mediaKey);
  const ciphertext = aesEncryptGCM(recpBuffer, retryKey, iv, Buffer.from(key.id!));

  const req: BinaryNode = {
    tag: "receipt",
    attrs: {
      id: key.id!,
      to: jidNormalizedUser(meId),
      type: "server-error",
    },
    content: [
      // this encrypt node is actually pretty useless
      // the media is returned even without this node
      // keeping it here to maintain parity with WA Web
      {
        tag: "encrypt",
        attrs: {},
        content: [
          { tag: "enc_p", attrs: {}, content: ciphertext },
          { tag: "enc_iv", attrs: {}, content: iv },
        ],
      },
      {
        tag: "rmr",
        attrs: {
          jid: key.remoteJid!,
          from_me: (!!key.fromMe).toString(),
          // @ts-ignore
          participant: key.participant || undefined,
        },
      },
    ],
  };

  return req;
};

export const decodeMediaRetryNode = (node: BinaryNode) => {
  const rmrNode = getBinaryNodeChild(node, "rmr")!;

  const event: BaileysEventMap["messages.media-update"][number] = {
    key: {
      id: node.attrs.id,
      remoteJid: rmrNode.attrs.jid,
      fromMe: rmrNode.attrs.from_me === "true",
      participant: rmrNode.attrs.participant,
    },
  };

  const errorNode = getBinaryNodeChild(node, "error");
  if (errorNode) {
    const errorCode = +errorNode.attrs.code;
    event.error = new Boom(`Failed to re-upload media (${errorCode})`, {
      data: errorNode.attrs,
      statusCode: getStatusCodeForMediaRetry(errorCode),
    });
  } else {
    const encryptedInfoNode = getBinaryNodeChild(node, "encrypt");
    const ciphertext = getBinaryNodeChildBuffer(encryptedInfoNode, "enc_p");
    const iv = getBinaryNodeChildBuffer(encryptedInfoNode, "enc_iv");
    if (ciphertext && iv) {
      event.media = { ciphertext, iv };
    } else {
      event.error = new Boom("Failed to re-upload media (missing ciphertext)", { statusCode: 404 });
    }
  }

  return event;
};

export const decryptMediaRetryData = async (
  { ciphertext, iv }: { ciphertext: Uint8Array; iv: Uint8Array },
  mediaKey: Uint8Array,
  msgId: string,
) => {
  const retryKey = await getMediaRetryKey(mediaKey);
  const plaintext = aesDecryptGCM(ciphertext, retryKey, iv, Buffer.from(msgId));
  return proto.MediaRetryNotification.decode(plaintext);
};

export const getStatusCodeForMediaRetry = (code: number) => MEDIA_RETRY_STATUS_MAP[code];

const MEDIA_RETRY_STATUS_MAP = {
  [proto.MediaRetryNotification.ResultType.SUCCESS]: 200,
  [proto.MediaRetryNotification.ResultType.DECRYPTION_ERROR]: 412,
  [proto.MediaRetryNotification.ResultType.NOT_FOUND]: 404,
  [proto.MediaRetryNotification.ResultType.GENERAL_ERROR]: 418,
} as const;
