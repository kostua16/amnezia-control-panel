import { Server as SocketIOServer } from 'socket.io';

declare global {
  // eslint-disable-next-line no-var
  var __socketIO: SocketIOServer | undefined;
}

export {};
