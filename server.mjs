import { createServer } from 'http';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { jwtVerify } from 'jose';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3333', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

/** Encoded JWT secret shared with the HTTP middleware and login route. */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Read a single named cookie value from the raw Cookie header. Socket.IO's
 * handshake request exposes the unparsed header (no cookie-parser is attached),
 * so the auth-token cookie must be extracted manually.
 */
function readCookie(cookieHeader, name) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  // Production restricts the realtime channel to the configured panel origin
  // and never falls back to a wildcard. Same-origin requests need no
  // Access-Control-Allow-Origin header, so an unset production allowlist
  // disables CORS instead of opening it. Dev allows any origin for local
  // tooling and alternate loopback hosts.
  const allowedWsOrigins = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Attach Socket.IO to the HTTP server
  const io = new SocketIOServer(httpServer, {
    path: '/api/ws',
    addTrailingSlash: false,
    cors: {
      origin: dev ? '*' : allowedWsOrigins.length ? allowedWsOrigins : false,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Authenticate the socket handshake with the same auth-token cookie/JWT the
  // HTTP middleware enforces. /api/ws is a PUBLIC_API_ROUTE in the middleware,
  // so without this gate any reachable client would receive the full telemetry
  // firehose (stats, resources, alerts, push progress) unauthenticated.
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.request.headers.cookie, 'auth-token');
      if (!token) {
        return next(new Error('unauthorized'));
      }
      await jwtVerify(token, getJwtSecret());
      next();
    } catch {
      next(new Error('unauthorized'));
    }
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

  // Graceful shutdown (SIGTERM/SIGINT cleanup) is registered in
  // instrumentation.ts, which runs inside Next.js's Node runtime where the
  // @/lib/* TypeScript sources resolve. server.mjs is plain Node and cannot
  // import those sources directly, so cleanup must live there, not here.

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
