const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for local testing
    methods: ['GET', 'POST'],
  },
});
 
app.get('/', (req, res) => {
  res.send('WebRTC Signaling Server');
});

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('New connection:', socket.id, 'IP:', socket.handshake.address);

  socket.on('join-room', (roomId, userId) => {
    socket.join(roomId);
    console.log(`User ${userId} (socket ${socket.id}) joined room ${roomId}`);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(userId);
    const usersInRoom = Array.from(rooms.get(roomId));
    console.log(`Current users in room ${roomId}:`, usersInRoom);

    io.to(roomId).emit('room-users', usersInRoom);
    socket.to(roomId).emit('user-connected', userId);

    socket.on('transcript', (roomId, userId, transcript, isFinal) => {
      console.log(`Transcript from ${userId} in room ${roomId}: ${transcript} (isFinal: ${isFinal})`);
      socket.to(roomId).emit('transcript', userId, transcript, isFinal);
    });

    socket.on('disconnect', () => {
      console.log(`User ${userId} (socket ${socket.id}) disconnected from room ${roomId}`);
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(userId);
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (empty)`);
        } else {
          const updatedUsers = Array.from(rooms.get(roomId));
          socket.to(roomId).emit('user-disconnected', userId);
          io.to(roomId).emit('room-users', updatedUsers);
          console.log(`Updated users in room ${roomId}:`, updatedUsers);
        }
      }
    });

    socket.on('offer', (roomId, offer, userId) => {
      console.log(`Offer from ${userId} in room ${roomId}:`, offer.sdp ? 'SDP present' : 'No SDP');
      socket.to(roomId).emit('offer', offer, userId);
    });

    socket.on('answer', (roomId, answer, userId) => {
      console.log(`Answer from ${userId} in room ${roomId}:`, answer.sdp ? 'SDP present' : 'No SDP');
      socket.to(roomId).emit('answer', answer, userId);
    });

    socket.on('ice-candidate', (roomId, candidate, userId) => {
      console.log(`ICE candidate from ${userId} in room ${roomId}:`, candidate.candidate ? candidate.candidate : 'Empty candidate');
      socket.to(roomId).emit('ice-candidate', candidate, userId);
    });
  });
});

server.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});