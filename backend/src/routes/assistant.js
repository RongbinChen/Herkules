// Workspace AI assistant — conversational endpoint grounded in module data.
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { runAssistant } from '../services/assistant.js';

const router = express.Router();
router.use(authenticateToken);

// POST /api/assistant/chat  { messages: [{role:'user'|'assistant', content}] }
router.post('/chat', async (req, res) => {
  try {
    const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!history.length || !String(history[history.length - 1]?.content || '').trim()) {
      return res.status(400).json({ error: 'messages is empty' });
    }
    const out = await runAssistant(history, req.user.userId);
    res.json(out);
  } catch (error) {
    if (error.isDeepSeek) return res.status(502).json({ error: error.message });
    console.error('Error in assistant chat:', error);
    res.status(500).json({ error: 'Assistant failed' });
  }
});

export default router;
