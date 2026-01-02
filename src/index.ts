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
  swaggerDefinition: {
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
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
        },
      },
    },
    security: [
      {
        ApiKeyAuth: [],
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

const authenticateApiKey = async (req: Request, res: Response, next: any) => {
  const apiKeyHeader = req.headers['x-api-key'];

  if (!apiKeyHeader || typeof apiKeyHeader !== 'string') {
    return res.status(401).json({ error: 'API key is missing or invalid' });
  }

  const keyRecord = await prisma.apiKey.findUnique({
    where: { key: apiKeyHeader },
  });

  if (!keyRecord || !keyRecord.active) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }

  res.locals.apiKey = keyRecord;
  next();
};

/**
 * @swagger
 * /api/keys/generate:
 *   post:
 *     summary: Generate a new API key
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: The generated API key
 */
app.post('/api/keys/generate', async (req: Request, res: Response): Promise<any> => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const key = require('crypto').randomBytes(32).toString('hex');
  try {
    const apiKeyRecord = await prisma.apiKey.create({
      data: { key, name },
    });
    res.json(apiKeyRecord);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

/**
 * @swagger
 * /api/chat/start:
 *   post:
 *     summary: Create a new chat session with an initial message
 *     tags: [Chat]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: The created session and the bot's first response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 session:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                 message:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     content:
 *                       type: string
 *                     sender:
 *                       type: string
 */
app.post('/api/chat/start', authenticateApiKey, async (req: Request, res: Response): Promise<any> => {
  const { message } = req.body || {};
  const apiKey = res.locals.apiKey;

  if (!message) {
    return res.status(400).json({ error: 'Initial message is required' });
  }

  try {
    const session = await prisma.chatSession.create({
      data: {
        apiKeyId: apiKey.id
      }
    });

    const botMessage = await processChat(session.id, message);

    res.json({
      session,
      message: botMessage
    });
  } catch (error) {
    console.error("Start Session Error:", error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

const processChat = async (sessionId: number, message: string) => {
  await prisma.message.create({
    data: {
      content: message,
      sender: 'user',
      chatSessionId: sessionId
    },
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

  const savedBotMessage = await prisma.message.create({
    data: {
      content: botResponse,
      sender: 'bot',
      chatSessionId: sessionId
    },
  });

  return savedBotMessage;
};

/**
 * @swagger
 * /api/chat/message:
 *   post:
 *     summary: Send a message to the bot
 *     tags: [Chat]
 *     security:
 *       - ApiKeyAuth: []
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
app.post('/api/chat/message', authenticateApiKey, async (req: Request, res: Response): Promise<any> => {
  const { sessionId, message } = req.body || {};
  const apiKey = res.locals.apiKey;

  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }

  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, apiKeyId: apiKey.id }
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    const savedBotMessage = await processChat(sessionId, message);
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
 *     security:
 *       - ApiKeyAuth: []
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
app.get('/api/chat/sessions', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const apiKey = res.locals.apiKey;
    const sessions = await prisma.chatSession.findMany({
      where: { apiKeyId: apiKey.id },
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
 *     security:
 *       - ApiKeyAuth: []
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
app.get('/api/chat/:sessionId', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const apiKey = res.locals.apiKey;
    const sessionId = Number(req.params.sessionId);

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, apiKeyId: apiKey.id }
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    const history = await prisma.message.findMany({
      where: { chatSessionId: sessionId },
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