# UAS-TST-Chatbot-API

API gateway integrated with **Google Gemini AI** and **Prisma** for persistent storage. This service allows you to manage chat sessions, track message history, and authenticate requests using custom API keys.

## Features

- **Gemini AI Integration**: Powered by Google's latest generative AI models.
- **Persistent Storage**: All chat sessions and messages are stored in a database (SQLite) via Prisma.
- **Session Management**: Easily start, continue, and retrieve chat histories.
- **API Key Authentication**: Secure your endpoints with custom-generated API keys.
- **Swagger Documentation**: Interactive API documentation for easy testing.
- **Docker Ready**: Containerized for easy deployment.

## Getting Started

### Prerequisites

- Node.js
- npm or yarn
- Google Gemini API Key

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/zaka2301-itb/UAS-TST-Chatbot-API
   cd UAS-TST-Chatbot-API
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```
   Required variables:
   - `GEMINI_API_KEY`: Your Google Gemini API Key.
   - `DATABASE_URL`: Prisma connection string (`file:./dev.db`).
   - `AI_MODEL`: (Optional) Default is `gemini-2.5-flash`.

4. **Initialize Database**:
   ```bash
   npx prisma migrate deploy
   ```

5. **Start the server**:
   ```bash
   npm run dev
   ```
   The server will start on `http://localhost:2301`.

### Running with Docker

You can also run the entire stack using Docker Compose:

```bash
docker-compose up -d
```
The service will be accessible at `http://localhost:2301`.

## Authentication

Most endpoints require an API key to be passed in the `x-api-key` header.

### 1. Generate an API Key
First, you need to generate a key:

**Endpoint**: `POST /api/keys/generate`  
**Body**:
```json
{
  "name": "My Application"
}
```
**Response**:
```json
{
  "key": "your-unique-api-key",
  "name": "My Application",
  ...
}
```

### 2. Using the API Key
Add the key to your request headers:
```http
x-api-key: your-unique-api-key
```

## API Documentation

Interactive documentation is available via Swagger at:  
👉 **`http://localhost:2301/api-docs`**

### Core Endpoints

#### 1. Start a New Chat
Initialize a session and send the first message.
- **URL**: `/api/chat/start`
- **Method**: `POST`
- **Headers**: `x-api-key: <your_key>`
- **Body**: `{ "message": "Hello AI!" }`

#### 2. Continue Chat
Send a message to an existing session.
- **URL**: `/api/chat/message`
- **Method**: `POST`
- **Headers**: `x-api-key: <your_key>`
- **Body**: `{ "sessionId": 1, "message": "Tell me more." }`

#### 3. List Sessions
Get all chat sessions associated with your API key.
- **URL**: `/api/chat/sessions`
- **Method**: `GET`
- **Headers**: `x-api-key: <your_key>`

#### 4. Get Session History
Retrieve all messages for a specific session.
- **URL**: `/api/chat/:sessionId`
- **Method**: `GET`
- **Headers**: `x-api-key: <your_key>`
