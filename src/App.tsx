/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  User, 
  Hash, 
  Sparkles, 
  MessageSquare, 
  ChevronRight, 
  LogOut,
  Smile,
  Paperclip,
  Mic,
  Settings,
  Search,
  Phone,
  PhoneOff,
  Volume2
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';

// --- Types ---
interface Message {
  id: string;
  text: string;
  sender: string;
  timestamp: number;
  isAI?: boolean;
}

interface UserProfile {
  name: string;
  color: string;
}

// --- Constants ---
const COLORS = [
  '#FF4E00', '#00FF00', '#00E0FF', '#FF00E5', '#FFD600', '#8F00FF'
];

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState('');
  const [userNameInput, setUserNameInput] = useState('');
  const [joined, setJoined] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  
  // WebRTC States
  const [isCalling, setIsCalling] = useState(false);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [callAccepted, setCallAccepted] = useState(false);
  const [callerInfo, setCallerInfo] = useState<{ name: string; from: string } | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // Load user from localStorage
  useEffect(() => {
    const savedUser = localStorage.getItem('velvet_user');
    if (savedUser) {
      const parsed = JSON.parse(savedUser);
      setUser(parsed);
      setUserNameInput(parsed.name);
    }
    const savedKey = localStorage.getItem('velvet_api_key');
    if (savedKey) {
      setApiKey(savedKey);
    }
  }, []);

  // Initialize Socket
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('receive-message', (data: Message) => {
      setMessages((prev) => [...prev, data]);
    });

    newSocket.on('message-history', (history: Message[]) => {
      setMessages(history);
    });

    newSocket.on('user-typing', (data: { isTyping: boolean }) => {
      setRemoteTyping(data.isTyping);
    });

    // WebRTC Listeners
    newSocket.on('incoming-call', async (data: { offer: RTCSessionDescriptionInit; from: string; callerName: string }) => {
      setIsIncomingCall(true);
      setCallerInfo({ name: data.callerName, from: data.from });
      
      // Store the offer to be used when answering
      (window as any).pendingOffer = data.offer;
    });

    newSocket.on('call-accepted', async (data: { answer: RTCSessionDescriptionInit }) => {
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        setCallAccepted(true);
      }
    });

    newSocket.on('ice-candidate', async (data: { candidate: RTCIceCandidateInit }) => {
      if (peerConnection.current) {
        try {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("Error adding ice candidate", e);
        }
      }
    });

    newSocket.on('call-ended', () => {
      handleEndCall(false);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // WebRTC Logic
  const setupPeerConnection = () => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    
    pc.onicecandidate = (event) => {
      if (event.candidate && socket && callerInfo) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          to: callerInfo.from,
          roomId
        });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };

    peerConnection.current = pc;
    return pc;
  };

  const handleStartCall = async () => {
    if (!socket || !user) return;
    setIsCalling(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current = stream;
      
      const pc = setupPeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('call-user', {
        offer,
        roomId,
        callerName: user.name
      });
    } catch (err) {
      console.error("Failed to get local stream", err);
      setIsCalling(false);
    }
  };

  const handleAcceptCall = async () => {
    if (!socket || !user || !callerInfo) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current = stream;
      
      const pc = setupPeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = (window as any).pendingOffer;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('answer-call', {
        answer,
        to: callerInfo.from,
        roomId
      });

      setIsIncomingCall(false);
      setCallAccepted(true);
    } catch (err) {
      console.error("Failed to accept call", err);
    }
  };

  const handleEndCall = (emit = true) => {
    if (emit && socket) {
      socket.emit('end-call', { roomId });
    }

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }

    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    setIsCalling(false);
    setIsIncomingCall(false);
    setCallAccepted(false);
    setCallerInfo(null);
    setRemoteStream(null);
  };

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, remoteTyping]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId.trim() || !userNameInput.trim() || !socket) return;
    
    let currentUser = user;
    if (!currentUser || currentUser.name !== userNameInput) {
      const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];
      currentUser = { name: userNameInput, color: randomColor };
      setUser(currentUser);
      localStorage.setItem('velvet_user', JSON.stringify(currentUser));
    }
    
    socket.emit('join-room', roomId);
    setJoined(true);
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || !socket || !user) return;

    const messageData: Message = {
      id: Math.random().toString(36).substr(2, 9),
      text: inputText,
      sender: user.name,
      timestamp: Date.now(),
    };

    socket.emit('send-message', { ...messageData, roomId });
    setInputText('');
    
    // Clear typing status
    socket.emit('typing', { roomId, isTyping: false });
    setIsTyping(false);

    // AI Trigger: If message starts with /ai or contains "hey ai"
    if (inputText.toLowerCase().startsWith('/ai') || inputText.toLowerCase().includes('hey ai')) {
      handleAIResponse(inputText);
    }
  };

  const handleAIResponse = async (prompt: string) => {
    setAiLoading(true);
    try {
      const effectiveKey = apiKey || process.env.GEMINI_API_KEY || '';
      const ai = new GoogleGenAI({ apiKey: effectiveKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are an AI assistant in a group chat. Keep your response concise and helpful. Context: ${prompt}`,
      });

      const aiMessage: Message = {
        id: 'ai-' + Date.now(),
        text: response.text || "I'm sorry, I couldn't process that.",
        sender: 'Velvet AI',
        timestamp: Date.now(),
        isAI: true,
      };

      socket?.emit('send-message', { ...aiMessage, roomId });
    } catch (error) {
      console.error("AI Error:", error);
    } finally {
      setAiLoading(false);
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    
    if (!isTyping && socket) {
      setIsTyping(true);
      socket.emit('typing', { roomId, isTyping: true });
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      if (socket) {
        socket.emit('typing', { roomId, isTyping: false });
        setIsTyping(false);
      }
    }, 2000);
  };

  const handleSaveApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('velvet_api_key', apiKey);
    setShowSettings(false);
  };

  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 relative">
        <div className="atmosphere" />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md glass p-8 rounded-3xl shadow-2xl"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-600/20">
              <MessageSquare className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-serif font-bold tracking-tight">Velvet Chat</h1>
              <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Secure & Smooth</p>
            </div>
          </div>

          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 ml-1">
                Your Name
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-4 h-4" />
                <input 
                  type="text" 
                  value={userNameInput}
                  onChange={(e) => setUserNameInput(e.target.value)}
                  placeholder="What's your name?"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 ml-1">
                Room Identity
              </label>
              <div className="relative">
                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-4 h-4" />
                <input 
                  type="text" 
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="Enter room name..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/20"
                />
              </div>
            </div>
            
            <button 
              type="submit"
              disabled={!roomId.trim() || !userNameInput.trim()}
              className="w-full bg-white text-black font-semibold py-4 rounded-2xl hover:bg-orange-500 hover:text-white transition-all duration-300 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Enter Room
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between text-[10px] text-white/30 uppercase tracking-widest font-bold">
            <span>P2P Encrypted</span>
            <span>AI Enhanced</span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col md:flex-row relative">
      <div className="atmosphere" />
      <audio ref={remoteAudioRef} autoPlay />
      
      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="glass p-8 rounded-3xl w-full max-w-md shadow-2xl border-white/10"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                    <Settings className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-xl font-bold">Settings</h2>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="text-white/40 hover:text-white transition-colors"
                >
                  <LogOut className="w-5 h-5 rotate-180" />
                </button>
              </div>

              <form onSubmit={handleSaveApiKey} className="space-y-6">
                <div>
                  <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 ml-1">
                    Gemini API Key
                  </label>
                  <div className="relative">
                    <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-4 h-4" />
                    <input 
                      type="password" 
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter your custom API key..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/20"
                    />
                  </div>
                  <p className="mt-2 text-[10px] text-white/30 leading-relaxed px-1">
                    If left empty, the application will use the default system key. Your key is stored locally in your browser.
                  </p>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-white text-black font-semibold py-4 rounded-2xl hover:bg-orange-500 hover:text-white transition-all duration-300"
                >
                  Save Settings
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Call Overlays */}
      <AnimatePresence>
        {isIncomingCall && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
          >
            <div className="glass p-8 rounded-3xl w-full max-w-xs text-center">
              <div className="w-20 h-20 bg-orange-600 rounded-full mx-auto mb-4 flex items-center justify-center animate-pulse">
                <Phone className="text-white w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold mb-1">{callerInfo?.name}</h2>
              <p className="text-white/40 text-xs uppercase tracking-widest mb-8">Incoming Voice Call</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => handleEndCall()}
                  className="flex-1 bg-red-500/20 text-red-500 py-3 rounded-2xl hover:bg-red-500 hover:text-white transition-all font-bold"
                >
                  Decline
                </button>
                <button 
                  onClick={handleAcceptCall}
                  className="flex-1 bg-green-500 text-white py-3 rounded-2xl hover:bg-green-600 transition-all font-bold"
                >
                  Accept
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {(isCalling || callAccepted) && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-40 glass px-6 py-4 rounded-3xl flex items-center gap-6 shadow-2xl border-orange-500/20"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center">
                <Volume2 className="text-white w-5 h-5 animate-bounce" />
              </div>
              <div>
                <div className="text-sm font-bold">{callAccepted ? "On Call" : "Calling..."}</div>
                <div className="text-[10px] text-white/40 uppercase tracking-widest">
                  {callAccepted ? "Secure Audio" : "Waiting for answer"}
                </div>
              </div>
            </div>
            <button 
              onClick={() => handleEndCall()}
              className="w-10 h-10 bg-red-500 rounded-xl flex items-center justify-center hover:bg-red-600 transition-colors"
            >
              <PhoneOff className="text-white w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className="w-full md:w-72 glass border-r-0 md:border-r border-white/5 flex flex-col z-10">
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center">
              <MessageSquare className="text-white w-4 h-4" />
            </div>
            <span className="font-serif font-bold text-lg">Velvet</span>
          </div>
          <button onClick={() => setJoined(false)} className="text-white/40 hover:text-white transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
            <input 
              type="text" 
              placeholder="Search chats..." 
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2 pl-9 pr-4 text-xs focus:outline-none focus:border-white/10"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-2 scrollbar-hide">
          <div className="text-[10px] text-white/30 uppercase tracking-widest font-bold mb-4 ml-2">Active Room</div>
          <div className="bg-white/10 border border-white/10 p-3 rounded-2xl flex items-center gap-3 cursor-pointer">
            <div className="w-10 h-10 rounded-xl bg-orange-600/20 flex items-center justify-center text-orange-500 font-bold">
              #
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{roomId}</div>
              <div className="text-[10px] text-white/40">Active now</div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: user?.color }}
            >
              {user?.name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{user?.name}</div>
              <div className="text-[10px] text-white/40">Online</div>
            </div>
            <Settings 
              className="w-4 h-4 text-white/30 cursor-pointer hover:text-white transition-colors" 
              onClick={() => setShowSettings(true)} 
            />
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col h-full relative overflow-hidden">
        {/* Header */}
        <header className="h-16 glass border-b border-white/5 flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-3">
            <div className="text-white/40 font-mono text-xs"># {roomId}</div>
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleStartCall}
              disabled={isCalling || callAccepted}
              className="glass p-2 rounded-xl text-white/60 hover:text-white transition-colors disabled:opacity-30"
            >
              <Phone className="w-4 h-4" />
            </button>
            <div className="flex -space-x-2">
              {[1, 2].map(i => (
                <div key={i} className="w-7 h-7 rounded-full border-2 border-black bg-white/10 flex items-center justify-center text-[10px] font-bold">
                  {i === 1 ? user?.name[0] : '?'}
                </div>
              ))}
            </div>
            <button className="glass p-2 rounded-xl text-white/60 hover:text-white transition-colors">
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={`flex ${msg.sender === user?.name ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] md:max-w-[60%] flex gap-3 ${msg.sender === user?.name ? 'flex-row-reverse' : ''}`}>
                  {!msg.isAI && (
                    <div 
                      className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-1"
                      style={{ backgroundColor: msg.sender === user?.name ? user.color : '#444' }}
                    >
                      {msg.sender[0]}
                    </div>
                  )}
                  {msg.isAI && (
                    <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 mt-1">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div>
                    <div className={`px-4 py-3 rounded-2xl ${
                      msg.sender === user?.name 
                        ? 'bg-white text-black rounded-tr-none' 
                        : msg.isAI 
                          ? 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-100 rounded-tl-none'
                          : 'glass rounded-tl-none'
                    }`}>
                      {msg.isAI ? (
                        <div className="prose prose-invert prose-xs">
                          <Markdown>{msg.text}</Markdown>
                        </div>
                      ) : (
                        <p className="text-sm leading-relaxed">{msg.text}</p>
                      )}
                    </div>
                    <div className={`text-[9px] mt-1 text-white/30 uppercase tracking-widest font-bold ${msg.sender === user?.name ? 'text-right' : 'text-left'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {remoteTyping && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-2 items-center text-white/30 text-[10px] font-bold uppercase tracking-widest"
            >
              <div className="flex gap-1">
                <span className="w-1 h-1 bg-white/30 rounded-full animate-bounce" />
                <span className="w-1 h-1 bg-white/30 rounded-full animate-bounce [animation-delay:0.2s]" />
                <span className="w-1 h-1 bg-white/30 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
              Someone is typing
            </motion.div>
          )}

          {aiLoading && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-2 items-center text-indigo-400/50 text-[10px] font-bold uppercase tracking-widest"
            >
              <Sparkles className="w-3 h-3 animate-spin" />
              AI is thinking...
            </motion.div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-6 pt-0">
          <form 
            onSubmit={handleSend}
            className="glass rounded-3xl p-2 flex items-center gap-2 shadow-2xl"
          >
            <div className="flex items-center gap-1 px-2">
              <button type="button" className="p-2 text-white/30 hover:text-white transition-colors">
                <Paperclip className="w-5 h-5" />
              </button>
            </div>
            
            <input 
              type="text"
              value={inputText}
              onChange={handleTyping}
              placeholder="Type a message... (use /ai for help)"
              className="flex-1 bg-transparent py-3 px-2 text-sm focus:outline-none placeholder:text-white/20"
            />
            
            <div className="flex items-center gap-1 pr-2">
              <button type="button" className="p-2 text-white/30 hover:text-white transition-colors hidden sm:block">
                <Smile className="w-5 h-5" />
              </button>
              <button type="button" className="p-2 text-white/30 hover:text-white transition-colors hidden sm:block">
                <Mic className="w-5 h-5" />
              </button>
              <button 
                type="submit"
                disabled={!inputText.trim()}
                className="bg-white text-black p-3 rounded-2xl hover:bg-orange-500 hover:text-white transition-all duration-300 disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-black"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
          <div className="mt-3 flex justify-center">
            <p className="text-[9px] text-white/20 uppercase tracking-[0.2em] font-bold">
              Press Enter to send • Type <span className="text-indigo-400">/ai</span> for smart assistant
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
