import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const DEVICE_SECRET = process.env.DEVICE_SECRET;

const activeChats = new Map();
let pendingReaction = { mood: "normal", message: "" };

function moodFor(text) {
  const t = String(text || "").toLowerCase();

  if (/enojo|rabia|furia|odio/.test(t)) return "angry";
  if (/triste|miedo|mal|llor/.test(t)) return "sad";
  if (/sueñ|sueno|dormir|cansad/.test(t)) return "sleepy";
  if (/te quiero|te amo|amor|coraz[oó]n/.test(t)) return "love";
  if (/bail|baile|música|musica|fiesta|ritmo|vamos/.test(t)) return "excited";
  if (/wow|sorpresa|incre[ií]ble/.test(t)) return "surprised";
  if (/feliz|content|gracias|hola|bien|genial/.test(t)) return "happy";
  if (/[?¿]|por qu[eé]|c[oó]mo|duda|raro/.test(t)) return "confused";

  return "normal";
}

function mentionsNavi(text) {
  return /\bnavi\b/i.test(String(text || ""));
}

function cleanPrompt(text) {
  return String(text || "").replace(/\bnavi\b[,\s:]*/i, "").trim() || text;
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "navi" });
});

app.post("/telegram", async (req, res) => {
  if (req.headers["x-telegram-bot-api-secret-token"] !== TELEGRAM_SECRET) {
    return res.sendStatus(403);
  }

  res.json({ ok: true });

  const msg = req.body.message || req.body.edited_message;
  if (!msg?.text || !msg.chat?.id) return;

  const chatId = String(msg.chat.id);
  const text = String(msg.text).trim();
  const lower = text.toLowerCase();

  if (lower === "/start" || lower === "\\start") {
    activeChats.set(chatId, true);
    pendingReaction = { mood: "happy", message: "Inicio" };
    await sendTelegram(chatId, "Hola, soy NAVI. Ya estoy escuchando.");
    return;
  }

  if (lower === "/end" || lower === "\\end") {
    activeChats.set(chatId, false);
    pendingReaction = { mood: "normal", message: "Fin" };
    await sendTelegram(chatId, "Conversación terminada. Di /start para volver.");
    return;
  }

  const active = activeChats.get(chatId) === true;
  if (!active && !mentionsNavi(text)) return;
  if (mentionsNavi(text)) activeChats.set(chatId, true);

  pendingReaction = { mood: moodFor(text), message: "Escuchando" };

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: "Eres NAVI, un robot pequeño, cálido, curioso y divertido. Responde en español con 1 a 3 frases."
      },
      {
        role: "user",
        content: cleanPrompt(text)
      }
    ]
  });

  const answer = response.output_text || "Estoy aquí contigo.";
  pendingReaction = {
    mood: moodFor(text + " " + answer),
    message: answer.slice(0, 48)
  };

  await sendTelegram(chatId, answer);
});

app.get("/navi/reaction", (req, res) => {
  if (req.query.secret !== DEVICE_SECRET) return res.sendStatus(403);

  const reaction = pendingReaction;
  pendingReaction = { mood: "normal", message: "" };

  res.json(reaction);
});

app.listen(process.env.PORT || 3000, () => {
  console.log("NAVI server running");
});