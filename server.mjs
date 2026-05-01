import { createServer } from 'http';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3333', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  // Attach Socket.IO to the HTTP server
  const io = new SocketIOServer(httpServer, {
    path: '/api/ws',
    addTrailingSlash: false,
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`[ws] Client connected: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      console.log(`[ws] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  // Store the io instance globally so that server-side code can access it
  // This mirrors what src/lib/websocket.ts does, but runs at the right time
  globalThis.__socketIO = io;

  httpServer
    .once('error', (err) => {
      console.error('Server error:', err);
      process.exit(1);
    })
    .listen(port, hostname, () => {
      console.log(
        `> Server listening at http://${hostname}:${port} as ${
          dev ? 'development' : process.env.NODE_ENV
        }`,
      );
      console.log('> Socket.IO attached on /api/ws');
    });
});
