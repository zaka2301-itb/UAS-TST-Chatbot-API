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
      description: 'A Chatbot API integrated with Google Gemini AI and persistent storage.',
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
          description: 'Custom API Key for authenticating requests.',
        },
      },
      schemas: {
        Message: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Unique identifier for the message' },
            chatSessionId: { type: 'integer', description: 'ID of the chat session this message belongs to' },
            content: { type: 'string', description: 'The text content of the message' },
            sender: { type: 'string', enum: ['user', 'bot'], description: 'Originator of the message' },
            createdAt: { type: 'string', format: 'date-time', description: 'Timestamp when the message was created' },
          },
        },
        ChatSession: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Unique identifier for the session' },
            title: { type: 'string', nullable: true, description: 'AI-generated title for the session' },
            createdAt: { type: 'string', format: 'date-time', description: 'Timestamp when the session was created' },
            apiKeyId: { type: 'integer', description: 'ID of the API key used for this session' },
          },
        },
        ApiKey: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            key: { type: 'string' },
            name: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            active: { type: 'boolean' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Specific error message' },
          },
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
 *     description: Creates a unique API key associated with a name. This key is required for all Chat endpoints.
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
 *                 description: Friendly name for the API key owner
 *                 example: My App
 *     responses:
 *       200:
 *         description: Successfully generated API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiKey'
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 *     summary: Initialize a Chat Session
 *     description: Creates a new chat session and sends the first user message. Returns the session details and the bot's initial response.
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
 *                 description: The first message to start the conversation
 *                 example: Hello, who are you?
 *     responses:
 *       200:
 *         description: Session created and initial response received
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 session:
 *                   $ref: '#/components/schemas/ChatSession'
 *                 message:
 *                   $ref: '#/components/schemas/Message'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid or missing API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal processing error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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

    const updatedSession = await prisma.chatSession.findUnique({
      where: { id: session.id }
    });

    res.json({
      session: updatedSession,
      message: botMessage
    });
  } catch (error) {
    console.error("Start Session Error:", error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

const generateSessionTitle = async (message: string): Promise<string> => {
  try {
    const prompt = `Generate a very short, concise title (max 5 words) for a chat session starting with this message: "${message}". Return ONLY the title text, no quotes or explanation.`;

    const result = await genAI.models.generateContent({
      model: aiModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    return result.text?.trim() || "New Chat";
  } catch (error) {
    console.error("Title Generation Error:", error);
    return "New Chat";
  }
};

const processChat = async (sessionId: number, message: string) => {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { title: true }
  });

  if (session && !session.title) {
    const title = await generateSessionTitle(message);
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { title }
    });
  }

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
 *     summary: Send message to existing session
 *     description: Continues an ongoing conversation by sending a new message to a specific session ID.
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
 *                 description: ID of the active chat session
 *                 example: 1
 *               message:
 *                 type: string
 *                 description: User message content
 *                 example: Tell me more about that.
 *     responses:
 *       200:
 *         description: Bot's response retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Missing sessionId or message
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Session not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Processing error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 *     summary: List all user sessions
 *     description: Returns a list of all chat sessions linked to the provided API Key.
 *     tags: [Chat]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Successful retrieval
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ChatSession'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/chat/sessions', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const apiKey = res.locals.apiKey;
    const sessions = await prisma.chatSession.findMany({
      where: { apiKeyId: apiKey.id },
      orderBy: { createdAt: 'desc' },
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
 *     summary: Retrieve message history
 *     description: Fetches full message history for a specific session ID.
 *     tags: [Chat]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         schema:
 *           type: integer
 *         required: true
 *         description: The unique ID of the conversation session
 *     responses:
 *       200:
 *         description: History retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Message'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Session not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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