import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { PrismaClient } from '@prisma/client';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Chatbot API',
      version: '1.0.0',
      description: 'A simple chatbot API using Google GenAI SDK (v1) and MySQL',
    },
    servers: [
      {
        url: '/',
        description: 'Current Server',
      },
    ],
  },
  apis: ['./src/index.ts'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const prisma = new PrismaClient();

const apiKey = process.env.GEMINI_API_KEY;
const aiModel = process.env.AI_MODEL || 'gemini-2.5-flash';

if (!apiKey) {
  console.error("Missing GEMINI_API_KEY in .env file");
  process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey });

/**
 * @swagger
 * /api/chat/start:
 *   post:
 *     summary: Create a new chat session
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: The created session object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 */
app.post('/api/chat/start', async (req: Request, res: Response) => {
  try {
    const session = await prisma.chatSession.create({ data: {} });
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * @swagger
 * /api/chat/message:
 *   post:
 *     summary: Send a message to the bot
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - message
 *             properties:
 *               sessionId:
 *                 type: integer
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: The bot's response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 content:
 *                   type: string
 *                 sender:
 *                   type: string
 *                   example: bot
 */
app.post('/api/chat/message', async (req: Request, res: Response): Promise<any> => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }

  try {
    await prisma.message.create({
      data: { content: message, sender: 'user', chatSessionId: sessionId },
    });

    const history = await prisma.message.findMany({
      where: { chatSessionId: sessionId },
      orderBy: { createdAt: 'asc' },
    });

    const chatHistory = history.map((msg: any) => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    const chat = genAI.chats.create({
      model: aiModel,
      history: chatHistory.slice(0, -1),
    });

    const result = await chat.sendMessage({
      message: message
    });

    const botResponse = result.text || "No response text";

    if (!botResponse) {
      throw new Error("No response text from Gemini");
    }

    const savedBotMessage = await prisma.message.create({
      data: { content: botResponse, sender: 'bot', chatSessionId: sessionId },
    });

    res.json(savedBotMessage);

  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: 'Something went wrong processing the AI response' });
  }
});

/**
 * @swagger
 * /api/chat/sessions:
 *   get:
 *     summary: Retrieve all chat sessions
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: A list of chat sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 */
app.get('/api/chat/sessions', async (_req: Request, res: Response) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * @swagger
 * /api/chat/{sessionId}:
 *   get:
 *     summary: Get message history for a specific session
 *     tags: [Chat]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         schema:
 *           type: integer
 *         required: true
 *         description: The numeric ID of the chat session
 *     responses:
 *       200:
 *         description: The chat history
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   content:
 *                     type: string
 *                   sender:
 *                     type: string
 */
app.get('/api/chat/:sessionId', async (req: Request, res: Response) => {
  try {
    const history = await prisma.message.findMany({
      where: { chatSessionId: Number(req.params.sessionId) },
      orderBy: { createdAt: 'asc' },
    });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
});