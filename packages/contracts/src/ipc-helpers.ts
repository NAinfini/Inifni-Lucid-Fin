import type { IpcChannelMap } from './ipc.js';

export type IpcChannel = keyof IpcChannelMap;
export type IpcRequest<C extends IpcChannel> = IpcChannelMap[C]['request'];
export type IpcResponse<C extends IpcChannel> = IpcChannelMap[C]['response'];
