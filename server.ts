import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";

const db = new Database("chat.db");

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

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", (roomId) => {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room: ${roomId}`);

      // Fetch message history
      const stmt = db.prepare("SELECT * FROM messages WHERE roomId = ? ORDER BY timestamp ASC LIMIT 100");
      const history = stmt.all(roomId).map((msg: any) => ({
        ...msg,
        isAI: !!msg.isAI
      }));
      
      socket.emit("message-history", history);
    });

    socket.on("send-message", (data) => {
      // data: { id, roomId, text, sender, timestamp, isAI }
      const { id, roomId, text, sender, timestamp, isAI } = data;
      
      // Save to DB
      const stmt = db.prepare("INSERT INTO messages (id, roomId, text, sender, timestamp, isAI) VALUES (?, ?, ?, ?, ?, ?)");
      stmt.run(id, roomId, text, sender, timestamp, isAI ? 1 : 0);

      io.to(roomId).emit("receive-message", data);
    });

    // WebRTC Signaling
    socket.on("call-user", (data) => {
      // data: { offer, roomId, callerName }
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
