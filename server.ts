import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";

const dbPath = path.resolve(process.cwd(), "chat.db");
let db: any;
try {
  db = new Database(dbPath);
  console.log("Database connected at:", dbPath);
  // Initialize database
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      roomId TEXT,
      text TEXT,
      sender TEXT,
      timestamp INTEGER,
      isAI INTEGER DEFAULT 0
    )
  `);
} catch (err) {
  console.error("Database initialization failed. Falling back to in-memory mode.", err);
  try {
    db = new Database(":memory:");
  } catch (e) {
    console.error("Critical: Could not even start in-memory database.");
  }
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    allowEIO3: true,
    transports: ['polling', 'websocket']
  });

  const PORT = 3000;

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    
    socket.emit("connection-success", { id: socket.id });

    socket.on("ping", () => socket.emit("pong"));

    socket.on("join-room", (roomId) => {
      if (!roomId) return;
      socket.join(roomId);
      console.log(`User ${socket.id} joined room: ${roomId}`);

      // Fetch message history
      try {
        if (db) {
          const stmt = db.prepare("SELECT * FROM messages WHERE roomId = ? ORDER BY timestamp ASC LIMIT 100");
          const history = stmt.all(roomId).map((msg: any) => ({
            ...msg,
            isAI: !!msg.isAI
          }));
          socket.emit("message-history", history);
        }
      } catch (err) {
        console.error("Failed to fetch history for room", roomId, err);
      }
    });

    socket.on("send-message", (data) => {
      console.log("Broadcasting message to room:", data.roomId, data.text);
      const { id, roomId, text, sender, timestamp, isAI } = data;
      if (!roomId) return;
      
      // Save to DB
      try {
        if (db) {
          const stmt = db.prepare("INSERT INTO messages (id, roomId, text, sender, timestamp, isAI) VALUES (?, ?, ?, ?, ?, ?)");
          stmt.run(id, roomId, text, sender, timestamp, isAI ? 1 : 0);
        }
      } catch (err) {
        console.error("Failed to save message to DB:", err);
      }

      // Broadcast to EVERYONE in the room including sender
      io.to(roomId).emit("receive-message", data);
    });

    // WebRTC Signaling
    socket.on("call-user", (data) => {
      console.log("Call initiated in room:", data.roomId);
      socket.to(data.roomId).emit("incoming-call", {
        offer: data.offer,
        from: socket.id,
        callerName: data.callerName
      });
    });

    socket.on("answer-call", (data) => {
      // data: { answer, to, roomId }
      socket.to(data.to).emit("call-accepted", {
        answer: data.answer
      });
    });

    socket.on("ice-candidate", (data) => {
      // data: { candidate, to, roomId }
      socket.to(data.to).emit("ice-candidate", {
        candidate: data.candidate
      });
    });

    socket.on("end-call", (data) => {
      socket.to(data.roomId).emit("call-ended");
    });

    socket.on("typing", (data) => {
      socket.to(data.roomId).emit("user-typing", data);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
