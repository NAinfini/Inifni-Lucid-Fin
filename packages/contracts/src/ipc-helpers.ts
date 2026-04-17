import type { IpcChannelMap } from './ipc.js';

/** @deprecated Use the registry in `@lucid-fin/contracts-parse`. See ipc.ts. */
export type IpcChannel = keyof IpcChannelMap;
/** @deprecated Use the registry in `@lucid-fin/contracts-parse`. See ipc.ts. */
export type IpcRequest<C extends IpcChannel> = IpcChannelMap[C]['request'];
/** @deprecated Use the registry in `@lucid-fin/contracts-parse`. See ipc.ts. */
export type IpcResponse<C extends IpcChannel> = IpcChannelMap[C]['response'];
