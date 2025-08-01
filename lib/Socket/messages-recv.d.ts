import { Boom } from "@hapi/boom";
import Long = require("long");
import { proto } from "../../WAProto";
import { MessageReceiptType, MessageRelayOptions, SocketConfig, WAMessageKey } from "../Types";
import { BinaryNode } from "../WABinary";
export declare const makeMessagesRecvSocket: (config: SocketConfig) => {
    sendMessageAck: ({ tag, attrs, content }: BinaryNode, errorCode?: number) => Promise<void>;
    sendRetryRequest: (node: BinaryNode, forceIncludeKeys?: boolean) => Promise<void>;
    rejectCall: (callId: string, callFrom: string) => Promise<void>;
    fetchMessageHistory: (count: number, oldestMsgKey: WAMessageKey, oldestMsgTimestamp: number | Long) => Promise<string>;
    requestPlaceholderResend: (messageKey: WAMessageKey) => Promise<string | undefined>;
    getPrivacyTokens: (jids: string[]) => Promise<any>;
    assertSessions: (jids: string[], force: boolean) => Promise<boolean>;
    relayMessage: (jid: string, message: proto.IMessage, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, useCachedGroupMetadata, statusJidList, }: MessageRelayOptions) => Promise<string>;
    sendReceipt: (jid: string, participant: string | undefined, messageIds: string[], type: MessageReceiptType) => Promise<void>;
    sendReceipts: (keys: WAMessageKey[], type: MessageReceiptType) => Promise<void>;
    readMessages: (keys: WAMessageKey[]) => Promise<void>;
    refreshMediaConn: (forceGet?: boolean) => Promise<import("../Types").MediaConnInfo>;
    waUploadToServer: import("../Types").WAMediaUploadFunction;
    fetchPrivacySettings: (force?: boolean) => Promise<{
        [_: string]: string;
    }>;
    sendPeerDataOperationMessage: (pdoMessage: proto.Message.IPeerDataOperationRequestMessage) => Promise<string>;
    createParticipantNodes: (jids: string[], message: proto.IMessage, extraAttrs?: BinaryNode["attrs"]) => Promise<{
        nodes: BinaryNode[];
        shouldIncludeDeviceIdentity: boolean;
    }>;
    getUSyncDevices: (jids: string[], useCache: boolean, ignoreZeroDevices: boolean) => Promise<import("../WABinary").JidWithDevice[]>;
    updateMediaMessage: (message: proto.IWebMessageInfo) => Promise<proto.IWebMessageInfo>;
    sendMessage: (jid: string, content: import("../Types").AnyMessageContent, options?: import("../Types").MiscMessageGenerationOptions) => Promise<proto.WebMessageInfo | undefined>;
    newsletterCreate: (name: string, description?: string) => Promise<import("../Types").NewsletterMetadata>;
    newsletterUpdate: (jid: string, updates: import("../Types").NewsletterUpdate) => Promise<unknown>;
    newsletterSubscribers: (jid: string) => Promise<{
        subscribers: number;
    }>;
    newsletterMetadata: (type: "invite" | "jid", key: string) => Promise<import("../Types").NewsletterMetadata | null>;
    newsletterFollow: (jid: string) => Promise<unknown>;
    newsletterUnfollow: (jid: string) => Promise<unknown>;
    newsletterMute: (jid: string) => Promise<unknown>;
    newsletterUnmute: (jid: string) => Promise<unknown>;
    newsletterUpdateName: (jid: string, name: string) => Promise<unknown>;
    newsletterUpdateDescription: (jid: string, description: string) => Promise<unknown>;
    newsletterUpdatePicture: (jid: string, content: import("../Types").WAMediaUpload) => Promise<unknown>;
    newsletterRemovePicture: (jid: string) => Promise<unknown>;
    newsletterReactMessage: (jid: string, serverId: string, reaction?: string) => Promise<void>;
    newsletterFetchMessages: (jid: string, count: number, since: number, after: number) => Promise<any>;
    subscribeNewsletterUpdates: (jid: string) => Promise<{
        duration: string;
    } | null>;
    newsletterAdminCount: (jid: string) => Promise<number>;
    newsletterChangeOwner: (jid: string, newOwnerJid: string) => Promise<void>;
    newsletterDemote: (jid: string, userJid: string) => Promise<void>;
    newsletterDelete: (jid: string) => Promise<void>;
    groupMetadata: (jid: string) => Promise<import("../Types").GroupMetadata>;
    groupCreate: (subject: string, participants: string[]) => Promise<import("../Types").GroupMetadata>;
    groupLeave: (id: string) => Promise<void>;
    groupUpdateSubject: (jid: string, subject: string) => Promise<void>;
    groupRequestParticipantsList: (jid: string) => Promise<{
        [key: string]: string;
    }[]>;
    groupRequestParticipantsUpdate: (jid: string, participants: string[], action: "approve" | "reject") => Promise<{
        status: string;
        jid: string;
    }[]>;
    groupParticipantsUpdate: (jid: string, participants: string[], action: import("../Types").ParticipantAction) => Promise<{
        status: string;
        jid: string;
        content: BinaryNode;
    }[]>;
    groupUpdateDescription: (jid: string, description?: string) => Promise<void>;
    groupInviteCode: (jid: string) => Promise<string | undefined>;
    groupRevokeInvite: (jid: string) => Promise<string | undefined>;
    groupAcceptInvite: (code: string) => Promise<string | undefined>;
    groupRevokeInviteV4: (groupJid: string, invitedJid: string) => Promise<boolean>;
    groupAcceptInviteV4: (key: string | WAMessageKey, inviteMessage: proto.Message.IGroupInviteMessage) => Promise<any>;
    groupGetInviteInfo: (code: string) => Promise<import("../Types").GroupMetadata>;
    groupToggleEphemeral: (jid: string, ephemeralExpiration: number) => Promise<void>;
    groupSettingUpdate: (jid: string, setting: "announcement" | "not_announcement" | "locked" | "unlocked") => Promise<void>;
    groupMemberAddMode: (jid: string, mode: "admin_add" | "all_member_add") => Promise<void>;
    groupJoinApprovalMode: (jid: string, mode: "on" | "off") => Promise<void>;
    groupFetchAllParticipating: () => Promise<{
        [_: string]: import("../Types").GroupMetadata;
    }>;
    getBotListV2: () => Promise<import("../Types").BotListInfo[]>;
    processingMutex: {
        mutex<T>(code: () => Promise<T> | T): Promise<T>;
    };
    upsertMessage: (msg: import("../Types").WAMessage, type: import("../Types").MessageUpsertType) => Promise<void>;
    appPatch: (patchCreate: import("../Types").WAPatchCreate) => Promise<void>;
    sendPresenceUpdate: (type: import("../Types").WAPresence, toJid?: string) => Promise<void>;
    presenceSubscribe: (toJid: string, tcToken?: Buffer) => Promise<void>;
    profilePictureUrl: (jid: string, type?: "preview" | "image", timeoutMs?: number) => Promise<string | undefined>;
    onWhatsApp: (...jids: string[]) => Promise<{
        jid: string;
        exists: unknown;
        lid: unknown;
    }[] | undefined>;
    fetchBlocklist: () => Promise<string[]>;
    fetchStatus: (...jids: string[]) => Promise<import("..").USyncQueryResultList[] | undefined>;
    fetchDisappearingDuration: (...jids: string[]) => Promise<import("..").USyncQueryResultList[] | undefined>;
    updateProfilePicture: (jid: string, content: import("../Types").WAMediaUpload, dimensions?: {
        width: number;
        height: number;
    }) => Promise<void>;
    removeProfilePicture: (jid: string) => Promise<void>;
    updateProfileStatus: (status: string) => Promise<void>;
    updateProfileName: (name: string) => Promise<void>;
    updateBlockStatus: (jid: string, action: "block" | "unblock") => Promise<void>;
    updateCallPrivacy: (value: import("../Types").WAPrivacyCallValue) => Promise<void>;
    updateMessagesPrivacy: (value: import("../Types").WAPrivacyMessagesValue) => Promise<void>;
    updateLastSeenPrivacy: (value: import("../Types").WAPrivacyValue) => Promise<void>;
    updateOnlinePrivacy: (value: import("../Types").WAPrivacyOnlineValue) => Promise<void>;
    updateProfilePicturePrivacy: (value: import("../Types").WAPrivacyValue) => Promise<void>;
    updateStatusPrivacy: (value: import("../Types").WAPrivacyValue) => Promise<void>;
    updateReadReceiptsPrivacy: (value: import("../Types").WAReadReceiptsValue) => Promise<void>;
    updateGroupsAddPrivacy: (value: import("../Types").WAPrivacyGroupAddValue) => Promise<void>;
    updateDefaultDisappearingMode: (duration: number) => Promise<void>;
    getBusinessProfile: (jid: string) => Promise<import("../Types").WABusinessProfile | void>;
    resyncAppState: (collections: readonly ("critical_unblock_low" | "regular_high" | "regular_low" | "critical_block" | "regular")[], isInitialSync: boolean) => Promise<void>;
    chatModify: (mod: import("../Types").ChatModification, jid: string) => Promise<void>;
    cleanDirtyBits: (type: "account_sync" | "groups", fromTimestamp?: number | string) => Promise<void>;
    addLabel: (jid: string, labels: import("../Types/Label").LabelActionBody) => Promise<void>;
    addChatLabel: (jid: string, labelId: string) => Promise<void>;
    removeChatLabel: (jid: string, labelId: string) => Promise<void>;
    addMessageLabel: (jid: string, messageId: string, labelId: string) => Promise<void>;
    removeMessageLabel: (jid: string, messageId: string, labelId: string) => Promise<void>;
    star: (jid: string, messages: {
        id: string;
        fromMe?: boolean;
    }[], star: boolean) => Promise<void>;
    executeUSyncQuery: (usyncQuery: import("..").USyncQuery) => Promise<import("..").USyncQueryResult | undefined>;
    type: "md";
    ws: import("./Client").WebSocketClient;
    ev: import("../Types").BaileysEventEmitter & {
        process(handler: (events: Partial<import("../Types").BaileysEventMap>) => void | Promise<void>): () => void;
        buffer(): void;
        createBufferedFunction<A extends any[], T>(work: (...args: A) => Promise<T>): (...args: A) => Promise<T>;
        flush(force?: boolean): boolean;
        isBuffering(): boolean;
    };
    authState: {
        creds: import("../Types").AuthenticationCreds;
        keys: import("../Types").SignalKeyStoreWithTransaction;
    };
    signalRepository: import("../Types").SignalRepository;
    user: import("../Types").Contact | undefined;
    generateMessageTag: () => string;
    query: (node: BinaryNode, timeoutMs?: number) => Promise<any>;
    waitForMessage: <T>(msgId: string, timeoutMs?: number | undefined) => Promise<any>;
    waitForSocketOpen: () => Promise<void>;
    sendRawMessage: (data: Uint8Array | Buffer) => Promise<void>;
    sendNode: (frame: BinaryNode) => Promise<void>;
    logout: (msg?: string) => Promise<void>;
    end: (error: Error | undefined) => void;
    onUnexpectedError: (err: Error | Boom, msg: string) => void;
    uploadPreKeys: (count?: number) => Promise<void>;
    uploadPreKeysToServerIfRequired: () => Promise<void>;
    requestPairingCode: (phoneNumber: string, customPairingCode?: string) => Promise<string>;
    waitForConnectionUpdate: (check: (u: Partial<import("../Types").ConnectionState>) => Promise<boolean | undefined>, timeoutMs?: number) => Promise<void>;
    sendWAMBuffer: (wamBuffer: Buffer) => Promise<any>;
};
