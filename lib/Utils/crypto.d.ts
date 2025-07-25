import { KeyPair } from "../Types";
/** prefix version byte to the pub keys, required for some curve crypto functions */
export declare const generateSignalPubKey: (pubKey: Uint8Array | Buffer) => Uint8Array<ArrayBufferLike> | Buffer<ArrayBufferLike>;
export declare const Curve: {
    generateKeyPair: () => KeyPair;
    sharedKey: (privateKey: Uint8Array, publicKey: Uint8Array) => Buffer<any>;
    sign: (privateKey: Uint8Array, buf: Uint8Array) => any;
    verify: (pubKey: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean;
};
export declare const signedKeyPair: (identityKeyPair: KeyPair, keyId: number) => {
    keyPair: KeyPair;
    signature: any;
    keyId: number;
};
/**
 * encrypt AES 256 GCM;
 * where the tag tag is suffixed to the ciphertext
 * */
export declare function aesEncryptGCM(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array, additionalData: Uint8Array): Buffer<ArrayBuffer>;
/**
 * decrypt AES 256 GCM;
 * where the auth tag is suffixed to the ciphertext
 * */
export declare function aesDecryptGCM(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array, additionalData: Uint8Array): Buffer<ArrayBuffer>;
export declare function aesEncryptCTR(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): Buffer<ArrayBuffer>;
export declare function aesDecryptCTR(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Buffer<ArrayBuffer>;
/** decrypt AES 256 CBC; where the IV is prefixed to the buffer */
export declare function aesDecrypt(buffer: Buffer, key: Buffer): Buffer<ArrayBuffer>;
/** decrypt AES 256 CBC */
export declare function aesDecryptWithIV(buffer: Buffer, key: Buffer, IV: Buffer): Buffer<ArrayBuffer>;
export declare function aesEncrypt(buffer: Buffer | Uint8Array, key: Buffer): Buffer<ArrayBuffer>;
export declare function aesEncrypWithIV(buffer: Buffer, key: Buffer, IV: Buffer): Buffer<ArrayBuffer>;
export declare function hmacSign(buffer: Buffer | Uint8Array, key: Buffer | Uint8Array, variant?: "sha256" | "sha512"): Buffer<ArrayBufferLike>;
export declare function sha256(buffer: Buffer): Buffer<ArrayBufferLike>;
export declare function md5(buffer: Buffer): Buffer<ArrayBufferLike>;
export declare function hkdf(buffer: Uint8Array | Buffer, expandedLength: number, info: {
    salt?: Buffer;
    info?: string;
}): Promise<Buffer>;
export declare function derivePairingCodeKey(pairingCode: string, salt: Buffer): Promise<Buffer>;
