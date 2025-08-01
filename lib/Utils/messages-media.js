"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatusCodeForMediaRetry = exports.decryptMediaRetryData = exports.decodeMediaRetryNode = exports.encryptMediaRetryRequest = exports.getWAUploadToServer = exports.downloadEncryptedContent = exports.downloadContentFromMessage = exports.getUrlFromDirectPath = exports.encryptedStream = exports.getHttpStream = exports.getStream = exports.toBuffer = exports.toReadable = exports.mediaMessageSHA256B64 = exports.generateProfilePicture = exports.encodeBase64EncodedStringForUpload = exports.extractImageThumb = exports.getRawMediaUploadData = exports.hkdfInfoKey = void 0;
exports.getMediaKeys = getMediaKeys;
exports.getAudioDuration = getAudioDuration;
exports.getAudioDurationFallback = getAudioDurationFallback;
exports.getAudioWaveform = getAudioWaveform;
exports.generateThumbnail = generateThumbnail;
exports.extensionForMediaMessage = extensionForMediaMessage;
const Crypto = __importStar(require("node:crypto"));
const boom_1 = require("@hapi/boom");
const axios_1 = __importDefault(require("axios"));
const child_process_1 = require("child_process");
const events_1 = require("events");
const fs_1 = require("fs");
const jimp_1 = require("jimp");
const os_1 = require("os");
const path_1 = require("path");
const stream_1 = require("stream");
const util_1 = require("util");
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const WABinary_1 = require("../WABinary");
const crypto_1 = require("./crypto");
const generics_1 = require("./generics");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const getTmpFilesDirectory = () => (0, os_1.tmpdir)();
const getImageProcessingLibrary = async () => {
    const [jimp] = await Promise.all([Promise.resolve().then(() => __importStar(require("jimp"))).catch(() => { })]);
    if (jimp) {
        return { jimp };
    }
    throw new boom_1.Boom("No image processing library available");
};
const hkdfInfoKey = (type) => {
    const hkdfInfo = Defaults_1.MEDIA_HKDF_KEY_MAPPING[type];
    return `WhatsApp ${hkdfInfo} Keys`;
};
exports.hkdfInfoKey = hkdfInfoKey;
const getRawMediaUploadData = async (media, mediaType, logger) => {
    const { stream } = await (0, exports.getStream)(media);
    logger === null || logger === void 0 ? void 0 : logger.debug("got stream for raw upload");
    const hasher = Crypto.createHash("sha256");
    const filePath = (0, path_1.join)((0, os_1.tmpdir)(), mediaType + (0, generics_1.generateMessageIDV2)());
    const fileWriteStream = (0, fs_1.createWriteStream)(filePath);
    let fileLength = 0;
    try {
        for await (const data of stream) {
            fileLength += data.length;
            hasher.update(data);
            if (!fileWriteStream.write(data)) {
                await (0, events_1.once)(fileWriteStream, "drain");
            }
        }
        fileWriteStream.end();
        await (0, events_1.once)(fileWriteStream, "finish");
        stream.destroy();
        const fileSha256 = hasher.digest();
        logger === null || logger === void 0 ? void 0 : logger.debug("hashed data for raw upload");
        return {
            filePath: filePath,
            fileSha256,
            fileLength,
        };
    }
    catch (error) {
        fileWriteStream.destroy();
        stream.destroy();
        try {
            await fs_1.promises.unlink(filePath);
        }
        catch (_a) {
            //
        }
        throw error;
    }
};
exports.getRawMediaUploadData = getRawMediaUploadData;
/** generates all the keys required to encrypt/decrypt & sign a media message */
async function getMediaKeys(buffer, mediaType) {
    if (!buffer) {
        throw new boom_1.Boom("Cannot derive from empty media key");
    }
    if (typeof buffer === "string") {
        buffer = Buffer.from(buffer.replace("data:;base64,", ""), "base64");
    }
    // expand using HKDF to 112 bytes, also pass in the relevant app info
    const expandedMediaKey = await (0, crypto_1.hkdf)(buffer, 112, { info: (0, exports.hkdfInfoKey)(mediaType) });
    return {
        iv: expandedMediaKey.slice(0, 16),
        cipherKey: expandedMediaKey.slice(16, 48),
        macKey: expandedMediaKey.slice(48, 80),
    };
}
/** Extracts video thumb using FFMPEG */
const extractVideoThumb = async (path, destPath, time, size) => new Promise((resolve, reject) => {
    const cmd = `ffmpeg -ss ${time} -i ${path} -y -vf scale=${size.width}:-1 -vframes 1 -f image2 ${destPath}`;
    (0, child_process_1.exec)(cmd, (err) => {
        if (err) {
            reject(err);
        }
        else {
            resolve();
        }
    });
});
const extractImageThumb = async (bufferOrFilePath, width = 32) => {
    var _a;
    if (bufferOrFilePath instanceof stream_1.Readable) {
        bufferOrFilePath = await (0, exports.toBuffer)(bufferOrFilePath);
    }
    const lib = await getImageProcessingLibrary();
    if ("jimp" in lib && typeof ((_a = lib.jimp) === null || _a === void 0 ? void 0 : _a.Jimp) === "object") {
        const jimp = await lib.jimp.default.Jimp.read(bufferOrFilePath);
        const dimensions = {
            width: jimp.width,
            height: jimp.height,
        };
        const buffer = await jimp
            .resize({ w: width, mode: jimp_1.ResizeStrategy.BILINEAR })
            .getBuffer("image/jpeg", { quality: 50 });
        return {
            buffer,
            original: dimensions,
        };
    }
    else {
        throw new boom_1.Boom("No image processing library available");
    }
};
exports.extractImageThumb = extractImageThumb;
const encodeBase64EncodedStringForUpload = (b64) => encodeURIComponent(b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/\=+$/, ""));
exports.encodeBase64EncodedStringForUpload = encodeBase64EncodedStringForUpload;
const generateProfilePicture = async (mediaUpload, dimensions) => {
    var _a;
    let buffer;
    const { width: w = 640, height: h = 640 } = dimensions || {};
    if (Buffer.isBuffer(mediaUpload)) {
        buffer = mediaUpload;
    }
    else {
        // Use getStream to handle all WAMediaUpload types (Buffer, Stream, URL)
        const { stream } = await (0, exports.getStream)(mediaUpload);
        // Convert the resulting stream to a buffer
        buffer = await (0, exports.toBuffer)(stream);
    }
    const lib = await getImageProcessingLibrary();
    let img;
    if ("jimp" in lib && typeof ((_a = lib.jimp) === null || _a === void 0 ? void 0 : _a.Jimp) === "object") {
        const jimp = await lib.jimp.default.Jimp.read(buffer);
        const min = Math.min(jimp.width, jimp.height);
        const cropped = jimp.crop({ x: 0, y: 0, w: min, h: min });
        img = cropped
            .resize({ w, h, mode: jimp_1.ResizeStrategy.BILINEAR })
            .getBuffer("image/jpeg", { quality: 50 });
    }
    else {
        throw new boom_1.Boom("No image processing library available");
    }
    return {
        img: await img,
    };
};
exports.generateProfilePicture = generateProfilePicture;
/** gets the SHA256 of the given media message */
const mediaMessageSHA256B64 = (message) => {
    const media = Object.values(message)[0];
    return (media === null || media === void 0 ? void 0 : media.fileSha256) && Buffer.from(media.fileSha256).toString("base64");
};
exports.mediaMessageSHA256B64 = mediaMessageSHA256B64;
/**
 * Get audio duration using ffprobe (part of ffmpeg)
 * This replaces the music-metadata dependency
 */
async function getAudioDuration(buffer) {
    try {
        let filePath;
        let shouldCleanup = false;
        if (Buffer.isBuffer(buffer)) {
            // Write buffer to temporary file
            filePath = (0, path_1.join)(getTmpFilesDirectory(), "audio_" + (0, generics_1.generateMessageIDV2)());
            await fs_1.promises.writeFile(filePath, buffer);
            shouldCleanup = true;
        }
        else if (typeof buffer === "string") {
            // It's already a file path
            filePath = buffer;
        }
        else {
            // It's a readable stream, convert to buffer first
            const audioBuffer = await (0, exports.toBuffer)(buffer);
            filePath = (0, path_1.join)(getTmpFilesDirectory(), "audio_" + (0, generics_1.generateMessageIDV2)());
            await fs_1.promises.writeFile(filePath, audioBuffer);
            shouldCleanup = true;
        }
        try {
            // Use ffprobe to get audio duration
            const { stdout } = await execAsync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`);
            const duration = parseFloat(stdout.trim());
            return isNaN(duration) ? undefined : duration;
        }
        finally {
            // Clean up temporary file if we created one
            if (shouldCleanup) {
                try {
                    await fs_1.promises.unlink(filePath);
                }
                catch (_a) {
                    // Ignore cleanup errors
                }
            }
        }
    }
    catch (error) {
        // If ffprobe fails, return undefined
        return undefined;
    }
}
/**
 * Parse basic audio metadata from common formats
 * This is a simplified version that reads basic info from headers
 */
const parseAudioMetadata = (buffer) => {
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
    if (buffer.length > 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WAVE") {
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
async function getAudioDurationFallback(buffer) {
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
    }
    catch (error) {
        return undefined;
    }
}
function decodeWAV(buffer) {
    if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
        throw new Error("Invalid WAV file");
    }
    let offset = 12;
    let fmtChunk = null;
    let dataChunk = null;
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
        }
        else if (chunkId === "data") {
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
        }
        else if (fmtChunk.bitsPerSample === 8) {
            sample = (buffer.readUInt8(sampleOffset) - 128) / 128.0;
        }
        else if (fmtChunk.bitsPerSample === 24) {
            const byte1 = buffer.readUInt8(sampleOffset);
            const byte2 = buffer.readUInt8(sampleOffset + 1);
            const byte3 = buffer.readUInt8(sampleOffset + 2);
            sample = ((byte3 << 24) | (byte2 << 16) | (byte1 << 8)) / 2147483648.0;
        }
        else if (fmtChunk.bitsPerSample === 32) {
            sample = buffer.readInt32LE(sampleOffset) / 2147483648.0;
        }
        channelData[i] = sample;
    }
    return {
        sampleRate: fmtChunk.sampleRate,
        channelData,
    };
}
function detectAudioFormat(buffer) {
    if (buffer.length < 12)
        return "unknown";
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") {
        return "wav";
    }
    if (buffer.toString("ascii", 0, 3) === "ID3" ||
        (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
        return "mp3";
    }
    return "unknown";
}
function extractMP3Samples(buffer) {
    const samples = [];
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
        }
        else {
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
async function getAudioWaveform(buffer, logger) {
    try {
        let audioData;
        if (Buffer.isBuffer(buffer)) {
            audioData = buffer;
        }
        else if (typeof buffer === "string") {
            const rStream = (0, fs_1.createReadStream)(buffer);
            audioData = await (0, exports.toBuffer)(rStream);
        }
        else {
            audioData = await (0, exports.toBuffer)(buffer);
        }
        const format = detectAudioFormat(audioData);
        let rawData;
        if (format === "wav") {
            const decoded = decodeWAV(audioData);
            rawData = decoded.channelData;
        }
        else if (format === "mp3") {
            rawData = extractMP3Samples(audioData);
        }
        else {
            throw new Error("Unsupported audio format. Only WAV and basic MP3 supported.");
        }
        const samples = 64;
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData = [];
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
    }
    catch (e) {
        logger === null || logger === void 0 ? void 0 : logger.debug("Failed to generate waveform: " + e);
        throw e;
    }
}
const toReadable = (buffer) => {
    const readable = new stream_1.Readable({ read: () => { } });
    readable.push(buffer);
    readable.push(null);
    return readable;
};
exports.toReadable = toReadable;
const toBuffer = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    stream.destroy();
    return Buffer.concat(chunks);
};
exports.toBuffer = toBuffer;
const getStream = async (item, opts) => {
    if (Buffer.isBuffer(item)) {
        return { stream: (0, exports.toReadable)(item), type: "buffer" };
    }
    if ("stream" in item) {
        return { stream: item.stream, type: "readable" };
    }
    const urlStr = item.url.toString();
    if (urlStr.startsWith("data:")) {
        const buffer = Buffer.from(urlStr.split(",")[1], "base64");
        return { stream: (0, exports.toReadable)(buffer), type: "buffer" };
    }
    if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
        return { stream: await (0, exports.getHttpStream)(item.url, opts), type: "remote" };
    }
    return { stream: (0, fs_1.createReadStream)(item.url), type: "file" };
};
exports.getStream = getStream;
/** generates a thumbnail for a given media, if required */
async function generateThumbnail(file, mediaType, options) {
    var _a;
    let thumbnail;
    let originalImageDimensions;
    if (mediaType === "image") {
        const { buffer, original } = await (0, exports.extractImageThumb)(file);
        thumbnail = buffer.toString("base64");
        if (original.width && original.height) {
            originalImageDimensions = {
                width: original.width,
                height: original.height,
            };
        }
    }
    else if (mediaType === "video") {
        const imgFilename = (0, path_1.join)(getTmpFilesDirectory(), (0, generics_1.generateMessageIDV2)() + ".jpg");
        try {
            await extractVideoThumb(file, imgFilename, "00:00:00", { width: 32, height: 32 });
            const buff = await fs_1.promises.readFile(imgFilename);
            thumbnail = buff.toString("base64");
            await fs_1.promises.unlink(imgFilename);
        }
        catch (err) {
            (_a = options.logger) === null || _a === void 0 ? void 0 : _a.debug("could not generate video thumb: " + err);
        }
    }
    return {
        thumbnail,
        originalImageDimensions,
    };
}
const getHttpStream = async (url, options = {}) => {
    const fetched = await axios_1.default.get(url.toString(), { ...options, responseType: "stream" });
    return fetched.data;
};
exports.getHttpStream = getHttpStream;
const encryptedStream = async (media, mediaType, { logger, saveOriginalFileIfRequired, opts } = {}) => {
    var _a, _b;
    const { stream, type } = await (0, exports.getStream)(media, opts);
    logger === null || logger === void 0 ? void 0 : logger.debug("fetched media stream");
    const mediaKey = Crypto.randomBytes(32);
    const { cipherKey, iv, macKey } = await getMediaKeys(mediaKey, mediaType);
    const encFilePath = (0, path_1.join)(getTmpFilesDirectory(), mediaType + (0, generics_1.generateMessageIDV2)() + "-enc");
    const encFileWriteStream = (0, fs_1.createWriteStream)(encFilePath);
    let originalFileStream;
    let originalFilePath;
    if (saveOriginalFileIfRequired) {
        originalFilePath = (0, path_1.join)(getTmpFilesDirectory(), mediaType + (0, generics_1.generateMessageIDV2)() + "-original");
        originalFileStream = (0, fs_1.createWriteStream)(originalFilePath);
    }
    let fileLength = 0;
    const aes = Crypto.createCipheriv("aes-256-cbc", cipherKey, iv);
    const hmac = Crypto.createHmac("sha256", macKey).update(iv);
    const sha256Plain = Crypto.createHash("sha256");
    const sha256Enc = Crypto.createHash("sha256");
    const onChunk = (buff) => {
        sha256Enc.update(buff);
        hmac.update(buff);
        encFileWriteStream.write(buff);
    };
    try {
        for await (const data of stream) {
            fileLength += data.length;
            if (type === "remote" &&
                (opts === null || opts === void 0 ? void 0 : opts.maxContentLength) &&
                fileLength + data.length > opts.maxContentLength) {
                throw new boom_1.Boom(`content length exceeded when encrypting "${type}"`, {
                    data: { media, type },
                });
            }
            if (originalFileStream) {
                if (!originalFileStream.write(data)) {
                    await (0, events_1.once)(originalFileStream, "drain");
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
        (_a = originalFileStream === null || originalFileStream === void 0 ? void 0 : originalFileStream.end) === null || _a === void 0 ? void 0 : _a.call(originalFileStream);
        stream.destroy();
        logger === null || logger === void 0 ? void 0 : logger.debug("encrypted data successfully");
        return {
            mediaKey,
            originalFilePath,
            encFilePath,
            mac,
            fileEncSha256,
            fileSha256,
            fileLength,
        };
    }
    catch (error) {
        // destroy all streams with error
        encFileWriteStream.destroy();
        (_b = originalFileStream === null || originalFileStream === void 0 ? void 0 : originalFileStream.destroy) === null || _b === void 0 ? void 0 : _b.call(originalFileStream);
        aes.destroy();
        hmac.destroy();
        sha256Plain.destroy();
        sha256Enc.destroy();
        stream.destroy();
        try {
            await fs_1.promises.unlink(encFilePath);
            if (originalFilePath) {
                await fs_1.promises.unlink(originalFilePath);
            }
        }
        catch (err) {
            logger === null || logger === void 0 ? void 0 : logger.error({ err }, "failed deleting tmp files");
        }
        throw error;
    }
};
exports.encryptedStream = encryptedStream;
const DEF_HOST = "mmg.whatsapp.net";
const AES_CHUNK_SIZE = 16;
const toSmallestChunkSize = (num) => {
    return Math.floor(num / AES_CHUNK_SIZE) * AES_CHUNK_SIZE;
};
const getUrlFromDirectPath = (directPath) => `https://${DEF_HOST}${directPath}`;
exports.getUrlFromDirectPath = getUrlFromDirectPath;
const downloadContentFromMessage = async ({ mediaKey, directPath, url }, type, opts = {}) => {
    const isValidMediaUrl = url === null || url === void 0 ? void 0 : url.startsWith("https://mmg.whatsapp.net/");
    const downloadUrl = isValidMediaUrl ? url : (0, exports.getUrlFromDirectPath)(directPath);
    if (!downloadUrl) {
        throw new boom_1.Boom("No valid media URL or directPath present in message", { statusCode: 400 });
    }
    const keys = await getMediaKeys(mediaKey, type);
    return (0, exports.downloadEncryptedContent)(downloadUrl, keys, opts);
};
exports.downloadContentFromMessage = downloadContentFromMessage;
/**
 * Decrypts and downloads an AES256-CBC encrypted file given the keys.
 * Assumes the SHA256 of the plaintext is appended to the end of the ciphertext
 * */
const downloadEncryptedContent = async (downloadUrl, { cipherKey, iv }, { startByte, endByte, options } = {}) => {
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
    const headers = {
        ...((options === null || options === void 0 ? void 0 : options.headers) || {}),
        Origin: Defaults_1.DEFAULT_ORIGIN,
    };
    if (startChunk || endChunk) {
        headers.Range = `bytes=${startChunk}-`;
        if (endChunk) {
            headers.Range += endChunk;
        }
    }
    // download the message
    const fetched = await (0, exports.getHttpStream)(downloadUrl, {
        ...(options || {}),
        headers,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
    });
    let remainingBytes = Buffer.from([]);
    let aes;
    const pushBytes = (bytes, push) => {
        if (startByte || endByte) {
            const start = bytesFetched >= startByte ? undefined : Math.max(startByte - bytesFetched, 0);
            const end = bytesFetched + bytes.length < endByte ? undefined : Math.max(endByte - bytesFetched, 0);
            push(bytes.slice(start, end));
            bytesFetched += bytes.length;
        }
        else {
            push(bytes);
        }
    };
    const output = new stream_1.Transform({
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
            }
            catch (error) {
                callback(error);
            }
        },
        final(callback) {
            try {
                pushBytes(aes.final(), (b) => this.push(b));
                callback();
            }
            catch (error) {
                callback(error);
            }
        },
    });
    return fetched.pipe(output, { end: true });
};
exports.downloadEncryptedContent = downloadEncryptedContent;
function extensionForMediaMessage(message) {
    const getExtension = (mimetype) => mimetype.split(";")[0].split("/")[1];
    const type = Object.keys(message)[0];
    let extension;
    if (type === "locationMessage" || type === "liveLocationMessage" || type === "productMessage") {
        extension = ".jpeg";
    }
    else {
        const messageContent = message[type];
        extension = getExtension(messageContent.mimetype);
    }
    return extension;
}
const getWAUploadToServer = ({ customUploadHosts, fetchAgent, logger, options }, refreshMediaConn) => {
    return async (filePath, { mediaType, fileEncSha256B64, timeoutMs }) => {
        var _a, _b;
        // send a query JSON to obtain the url & auth token to upload our media
        let uploadInfo = await refreshMediaConn(false);
        let urls;
        const hosts = [...customUploadHosts, ...uploadInfo.hosts];
        fileEncSha256B64 = (0, exports.encodeBase64EncodedStringForUpload)(fileEncSha256B64);
        for (const { hostname } of hosts) {
            logger.debug(`uploading to "${hostname}"`);
            const auth = encodeURIComponent(uploadInfo.auth); // the auth token
            const url = `https://${hostname}${Defaults_1.MEDIA_PATH_MAP[mediaType]}/${fileEncSha256B64}?auth=${auth}&token=${fileEncSha256B64}`;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let result;
            try {
                const body = await axios_1.default.post(url, (0, fs_1.createReadStream)(filePath), {
                    ...options,
                    maxRedirects: 0,
                    headers: {
                        ...(options.headers || {}),
                        "Content-Type": "application/octet-stream",
                        Origin: Defaults_1.DEFAULT_ORIGIN,
                    },
                    httpsAgent: fetchAgent,
                    timeout: timeoutMs,
                    responseType: "json",
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity,
                });
                result = body.data;
                if ((result === null || result === void 0 ? void 0 : result.url) || (result === null || result === void 0 ? void 0 : result.directPath)) {
                    urls = {
                        mediaUrl: result.url,
                        directPath: result.direct_path,
                    };
                    break;
                }
                else {
                    uploadInfo = await refreshMediaConn(true);
                    throw new Error(`upload failed, reason: ${JSON.stringify(result)}`);
                }
            }
            catch (error) {
                if (axios_1.default.isAxiosError(error)) {
                    result = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data;
                }
                const isLast = hostname === ((_b = hosts[uploadInfo.hosts.length - 1]) === null || _b === void 0 ? void 0 : _b.hostname);
                logger.warn({ trace: error.stack, uploadResult: result }, `Error in uploading to ${hostname} ${isLast ? "" : ", retrying..."}`);
            }
        }
        if (!urls) {
            throw new boom_1.Boom("Media upload failed on all hosts", { statusCode: 500 });
        }
        return urls;
    };
};
exports.getWAUploadToServer = getWAUploadToServer;
const getMediaRetryKey = (mediaKey) => {
    return (0, crypto_1.hkdf)(mediaKey, 32, { info: "WhatsApp Media Retry Notification" });
};
/**
 * Generate a binary node that will request the phone to re-upload the media & return the newly uploaded URL
 */
const encryptMediaRetryRequest = async (key, mediaKey, meId) => {
    const recp = { stanzaId: key.id };
    const recpBuffer = WAProto_1.proto.ServerErrorReceipt.encode(recp).finish();
    const iv = Crypto.randomBytes(12);
    const retryKey = await getMediaRetryKey(mediaKey);
    const ciphertext = (0, crypto_1.aesEncryptGCM)(recpBuffer, retryKey, iv, Buffer.from(key.id));
    const req = {
        tag: "receipt",
        attrs: {
            id: key.id,
            to: (0, WABinary_1.jidNormalizedUser)(meId),
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
                    jid: key.remoteJid,
                    from_me: (!!key.fromMe).toString(),
                    // @ts-ignore
                    participant: key.participant || undefined,
                },
            },
        ],
    };
    return req;
};
exports.encryptMediaRetryRequest = encryptMediaRetryRequest;
const decodeMediaRetryNode = (node) => {
    const rmrNode = (0, WABinary_1.getBinaryNodeChild)(node, "rmr");
    const event = {
        key: {
            id: node.attrs.id,
            remoteJid: rmrNode.attrs.jid,
            fromMe: rmrNode.attrs.from_me === "true",
            participant: rmrNode.attrs.participant,
        },
    };
    const errorNode = (0, WABinary_1.getBinaryNodeChild)(node, "error");
    if (errorNode) {
        const errorCode = +errorNode.attrs.code;
        event.error = new boom_1.Boom(`Failed to re-upload media (${errorCode})`, {
            data: errorNode.attrs,
            statusCode: (0, exports.getStatusCodeForMediaRetry)(errorCode),
        });
    }
    else {
        const encryptedInfoNode = (0, WABinary_1.getBinaryNodeChild)(node, "encrypt");
        const ciphertext = (0, WABinary_1.getBinaryNodeChildBuffer)(encryptedInfoNode, "enc_p");
        const iv = (0, WABinary_1.getBinaryNodeChildBuffer)(encryptedInfoNode, "enc_iv");
        if (ciphertext && iv) {
            event.media = { ciphertext, iv };
        }
        else {
            event.error = new boom_1.Boom("Failed to re-upload media (missing ciphertext)", { statusCode: 404 });
        }
    }
    return event;
};
exports.decodeMediaRetryNode = decodeMediaRetryNode;
const decryptMediaRetryData = async ({ ciphertext, iv }, mediaKey, msgId) => {
    const retryKey = await getMediaRetryKey(mediaKey);
    const plaintext = (0, crypto_1.aesDecryptGCM)(ciphertext, retryKey, iv, Buffer.from(msgId));
    return WAProto_1.proto.MediaRetryNotification.decode(plaintext);
};
exports.decryptMediaRetryData = decryptMediaRetryData;
const getStatusCodeForMediaRetry = (code) => MEDIA_RETRY_STATUS_MAP[code];
exports.getStatusCodeForMediaRetry = getStatusCodeForMediaRetry;
const MEDIA_RETRY_STATUS_MAP = {
    [WAProto_1.proto.MediaRetryNotification.ResultType.SUCCESS]: 200,
    [WAProto_1.proto.MediaRetryNotification.ResultType.DECRYPTION_ERROR]: 412,
    [WAProto_1.proto.MediaRetryNotification.ResultType.NOT_FOUND]: 404,
    [WAProto_1.proto.MediaRetryNotification.ResultType.GENERAL_ERROR]: 418,
};
