import makeWASocket from './Socket';
export * from '../WAProto';
export * from './Defaults';
export * from './Types';
export * from './Utils';
export * from './WABinary';
export * from './WAM';
export * from './WAUSync';
export type WASocket = ReturnType<typeof makeWASocket>;
export { makeWASocket };
export default makeWASocket;
