// Workspace AI assistant — conversational endpoint grounded in module data,
// plus per-user thread persistence so a conversation survives refresh and
// another device. Contract-derived replies are redacted unless the same
// team's unlock token is present.
import express from 'express';
import { prisma } from '../index.js';
import { authenticateToken } from '../middleware/auth.js';
import { runAssistant } from '../services/assistant.js';
import { readContractUnlock } from '../services/contractUnlock.js';
import {
  threadTitleFrom,
  redactMessage,
  stepsForStore,
  sourcesForStore,
} from '../services/assistantPersistence.js';

const router = express.Router();
router.use(authenticateToken);

function replyLang(req) {
  const lang = req.body?.lang || req.query?.lang;
  return lang === 'zh' || lang === 'en' ? lang : 'en';
}

async function ownThread(id, userId) {
  const threadId = parseInt(id, 10);
  if (!Number.isInteger(threadId) || threadId <= 0) return null;
  const thread = await prisma.assistantThread.findFirst({
    where: { id: threadId, userId },
  });
  return thread;
}

// GET /api/assistant/threads
router.get('/threads', async (req, res) => {
  try {
    const rows = await prisma.assistantThread.findMany({
      where: { userId: req.user.userId },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
    });
    res.json(rows.map((t) => ({
      id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt, messageCount: t._count.messages,
    })));
  } catch (error) {
    console.error('Error listing assistant threads:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// POST /api/assistant/threads  — start a fresh empty thread (Clear)
router.post('/threads', async (req, res) => {
  try {
    const thread = await prisma.assistantThread.create({
      data: { userId: req.user.userId, title: 'New conversation' },
    });
    res.status(201).json({ id: thread.id, title: thread.title, createdAt: thread.createdAt, updatedAt: thread.updatedAt, messages: [] });
  } catch (error) {
    console.error('Error creating assistant thread:', error);
    res.status(500).json({ error: 'Failed to start a conversation' });
  }
});

// GET /api/assistant/threads/:id
router.get('/threads/:id', async (req, res) => {
  try {
    const thread = await ownThread(req.params.id, req.user.userId);
    if (!thread) return res.status(404).json({ error: 'Conversation not found' });
    const unlockTeam = readContractUnlock(req);
    const lang = replyLang(req);
    const messages = await prisma.assistantMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: messages.map((m) => redactMessage(m, unlockTeam, lang)),
    });
  } catch (error) {
    console.error('Error reading assistant thread:', error);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// DELETE /api/assistant/threads/:id
router.delete('/threads/:id', async (req, res) => {
  try {
    const thread = await ownThread(req.params.id, req.user.userId);
    if (!thread) return res.status(404).json({ error: 'Conversation not found' });
    await prisma.assistantThread.delete({ where: { id: thread.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting assistant thread:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// POST /api/assistant/chat  { messages, lang, threadId? }
router.post('/chat', async (req, res) => {
  try {
    const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!history.length || !String(history[history.length - 1]?.content || '').trim()) {
      return res.status(400).json({ error: 'messages is empty' });
    }
    const lang = ['zh', 'en'].includes(req.body?.lang) ? req.body.lang : undefined;
    const unlockTeam = readContractUnlock(req);

    let thread = null;
    if (req.body?.threadId) {
      thread = await ownThread(req.body.threadId, req.user.userId);
      if (!thread) return res.status(404).json({ error: 'Conversation not found' });
    } else {
      thread = await prisma.assistantThread.create({
        data: { userId: req.user.userId, title: threadTitleFrom(history[history.length - 1].content) },
      });
    }

    const lastUser = history[history.length - 1];
    await prisma.assistantMessage.create({
      data: {
        threadId: thread.id,
        role: 'user',
        content: String(lastUser.content || '').slice(0, 4000),
      },
    });
    if (!thread.title || thread.title === 'New conversation') {
      await prisma.assistantThread.update({
        where: { id: thread.id },
        data: { title: threadTitleFrom(lastUser.content) },
      });
    }

    const out = await runAssistant(history, req.user, lang, unlockTeam);

    const stored = await prisma.assistantMessage.create({
      data: {
        threadId: thread.id,
        role: 'assistant',
        content: String(out.reply || '').slice(0, 20000),
        steps: stepsForStore(out.steps),
        sources: sourcesForStore(out.sources),
        suggestions: out.suggestions || [],
        sensitiveTeam: out.sensitiveTeam || null,
      },
    });
    await prisma.assistantThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });

    const visible = redactMessage({
      ...stored,
      steps: out.steps,
      sources: out.sources,
      suggestions: out.suggestions,
      sensitiveTeam: out.sensitiveTeam,
    }, unlockTeam, lang === 'zh' ? 'zh' : 'en');

    res.json({
      reply: visible.content,
      steps: visible.steps || out.steps,
      sources: visible.sources || out.sources,
      suggestions: visible.suggestions || out.suggestions,
      redacted: visible.redacted === true,
      threadId: thread.id,
    });
  } catch (error) {
    if (error.isDeepSeek) return res.status(502).json({ error: error.message });
    console.error('Error in assistant chat:', error);
    res.status(500).json({ error: 'Assistant failed' });
  }
});

export default router;
