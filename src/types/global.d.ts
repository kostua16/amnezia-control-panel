import { Server as SocketIOServer } from 'socket.io';

declare global {
  var __socketIO: SocketIOServer | undefined;
}

export {};
