import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth';
import restaurantRoutes from './routes/restaurant';
import driverRoutes from './routes/driver';
import adminRoutes from './routes/admin';

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/admin', adminRoutes);

// Socket.io placeholder
io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.join('user:' + userId);
  });
});

// Make io accessible to routes
app.set('io', io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log('Drako server running on port ' + PORT));
