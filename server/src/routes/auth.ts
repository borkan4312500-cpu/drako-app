import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.post('/register', async (req, res) => {
  const { name, phone, password, role } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, phone, password: hashed, role: role || 'CUSTOMER' }
  });
  res.json({ id: user.id, name: user.name, role: user.role });
});

router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ message: 'بيانات غير صحيحة' });
  }
  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '7d' }
  );
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

export default router;
