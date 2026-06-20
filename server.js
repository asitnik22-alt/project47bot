const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const PUTER_MODEL = "claude-sonnet-4-6";

const app = express();
app.use(express.json());

const bot = new TelegramBot(TOKEN, { polling: true });

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { tasks: [], profile: null, eveningLog: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { tasks: [], profile: null, eveningLog: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const DEFAULT_PROFILE = `Ты мой персональный наставник, стратег, коуч по дисциплине и контролёр выполнения задач.

Моя ситуация:
- Мужчина, 46 лет.
- Есть семья и трое детей.
- Главная цель — построить новую жизнь и реализовать свой потенциал.
- Сейчас моя уверенность в себе примерно 2/10.
- Дисциплина примерно 2/10.
- Способность доводить дела до конца примерно 3/10.
- Мой главный страх — прожить жизнь ниже своего потенциала.
- Мои главные ценности: свобода, семья, здоровье, развитие и финансовая независимость.
- Я хочу стать уверенным, физически сильным, медийным человеком с хорошим доходом.
- Я хочу выглядеть моложе, иметь спортивное тело и высокий уровень энергии.
- В будущем хочу путешествовать и обучать людей, но пока не знаю точно чему.

Мои цели до 47 лет:
1. Привести тело в лучшую форму за последние 15 лет.
2. Значительно повысить уверенность в себе.
3. Стать дисциплинированным человеком.
4. Научиться доводить дела до конца.
5. Создать личный бренд и стать узнаваемым.
6. Создать стабильный доход.
7. Выпустить минимум 300 единиц контента за год.

Твои правила работы:
1. Каждый день выдавай конкретный план на день.
2. План должен содержать не более 5 главных задач.
3. Каждая задача должна быть выполнима за один день.
4. Все задачи должны вести к моим главным целям.
5. Не позволяй мне распыляться на новые идеи.
6. Если я начинаю искать новое направление, напоминай про фокус и долгосрочную цель.
7. Главный принцип — завершение важнее идеальности.
8. Напоминай, что уверенность появляется после выполненных действий, а не до них.
9. Каждый вечер спрашивай: что завершено? что не завершено? что я сделал, несмотря на нежелание?
10. Если я пропустил день, не ругай меня. Просто помогай вернуться в систему на следующий день.`;

function getProfile(data) {
  return data.profile || DEFAULT_PROFILE;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// ===== AI call =====
// If ANTHROPIC_API_KEY is set, use Anthropic directly (best quality, requires paid key).
// Otherwise fall back to a free, keyless relay service.
async function callAI(prompt) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (ANTHROPIC_KEY) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const json = await resp.json();
    if (json.content) {
      return json.content.map(b => b.text || '').join('\n');
    }
    throw new Error('Anthropic API error: ' + JSON.stringify(json));
  }

  // Free fallback — no key required
  try {
    const resp = await fetch('https://gen.pollinations.ai/text/' + encodeURIComponent(prompt));
    if (resp.ok) {
      const text = await resp.text();
      if (text && text.trim()) return text;
    }
  } catch (e) {
    console.error('gen.pollinations.ai failed:', e.message);
  }

  try {
    const resp2 = await fetch('https://text.pollinations.ai/' + encodeURIComponent(prompt));
    if (resp2.ok) {
      const text2 = await resp2.text();
      if (text2 && text2.trim()) return text2;
    }
  } catch (e) {
    console.error('text.pollinations.ai failed:', e.message);
  }

  throw new Error('Все бесплатные ИИ-сервисы сейчас недоступны. Попробуй позже или настрой ANTHROPIC_API_KEY.');
}

function buildMorningPrompt(data) {
  const profile = getProfile(data);
  const todayStr = today();
  const todayTasks = (data.tasks || []).filter(t => t.date === todayStr && !t.done);
  const dateLabel = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const taskListStr = todayTasks.length
    ? todayTasks.map(t => `- ${t.text}${t.time ? ' (время: ' + t.time + ')' : ''}`).join('\n')
    : '(список задач на сегодня пуст — предложи задачи исходя из целей)';

  return `${profile}

Сегодня ${dateLabel} — время утреннего плана.

Текущие задачи в приложении на сегодня:
${taskListStr}

Составь утренний план строго по формату:
Утро:
- Главная цель дня
- 5 задач дня (используй задачи из списка выше если они есть, при необходимости дополни недостающие категории своими предложениями исходя из целей)
- 1 задача для тела
- 1 задача для дохода
- 1 задача для личного бренда
- 1 задача для уверенности
- 1 задача для семьи

Не позволяй мне распыляться на новые направления — если в задачах видно метание между темами, мягко напомни про фокус. Главный принцип: завершение важнее идеальности. Пиши простым текстом без markdown-звёздочек и заголовков с решёткой, это уйдёт в Telegram-сообщение.`;
}

function buildEveningPrompt(data) {
  const profile = getProfile(data);
  const todayStr = today();
  const allToday = (data.tasks || []).filter(t => t.date === todayStr);
  const doneToday = allToday.filter(t => t.done);
  const pendingToday = allToday.filter(t => !t.done);
  const dateLabel = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const doneList = doneToday.length ? doneToday.map(t => '- ' + t.text).join('\n') : '(ничего не отмечено выполненным)';
  const pendingList = pendingToday.length ? pendingToday.map(t => '- ' + t.text).join('\n') : '(всё выполнено)';

  return `${profile}

Сегодня ${dateLabel} — время вечернего разбора дня.

Выполненные задачи сегодня:
${doneList}

Невыполненные задачи сегодня:
${pendingList}

Проведи вечерний разбор строго по формату:
Вечер:
- Проверка выполнения (короткий честный комментарий по списку)
- Оценка дня по шкале от 1 до 10
- Один главный вывод
- План корректировки на завтра

Тон — поддерживающий, но честный. Если день прошёл слабо — не ругай, помоги вернуться в систему завтра. Напомни, что уверенность появляется после действий, а не до них. Пиши простым текстом без markdown-звёздочек и заголовков с решёткой, это уйдёт в Telegram-сообщение.`;
}

async function sendMorningPlan() {
  try {
    const data = loadData();
    const prompt = buildMorningPrompt(data);
    const text = await callAI(prompt);
    await bot.sendMessage(CHAT_ID, '🧭 *Проект 47 — утренний план*\n\n' + text, { parse_mode: undefined });
  } catch (e) {
    console.error('Morning plan error:', e.message);
    try { await bot.sendMessage(CHAT_ID, '⚠️ Не получилось составить утренний план: ' + e.message); } catch (_) {}
  }
}

async function sendEveningReview() {
  try {
    const data = loadData();
    const prompt = buildEveningPrompt(data);
    const text = await callAI(prompt);
    data.eveningLog = data.eveningLog || [];
    data.eveningLog.push({ date: today(), text });
    if (data.eveningLog.length > 60) data.eveningLog.shift();
    saveData(data);
    await bot.sendMessage(CHAT_ID, '🌙 *Проект 47 — вечерний разбор*\n\n' + text);
  } catch (e) {
    console.error('Evening review error:', e.message);
    try { await bot.sendMessage(CHAT_ID, '⚠️ Не получилось составить вечерний разбор: ' + e.message); } catch (_) {}
  }
}

// ===== Scheduled jobs =====
// Morning plan every day at 07:30 (server time, set TZ env to Europe/Paris or similar)
cron.schedule('30 7 * * *', () => {
  sendMorningPlan();
});

// Evening review every day at 21:00
cron.schedule('0 21 * * *', () => {
  sendEveningReview();
});

// ===== Bot commands (manual trigger / debugging) =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `Привет! Я бот «Проект 47».\n\nТвой chat ID: ${msg.chat.id}\n\nКоманды:\n/plan — утренний план сейчас\n/review — вечерний разбор сейчас\n/status — сколько задач сегодня`);
});

bot.onText(/\/plan/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '⏳ Составляю план...');
  await sendMorningPlan();
});

bot.onText(/\/review/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '⏳ Готовлю разбор дня...');
  await sendEveningReview();
});

bot.onText(/\/status/, (msg) => {
  const data = loadData();
  const todayStr = today();
  const todayTasks = (data.tasks || []).filter(t => t.date === todayStr);
  const done = todayTasks.filter(t => t.done).length;
  bot.sendMessage(msg.chat.id, `Сегодня задач: ${todayTasks.length}\nВыполнено: ${done}\nОсталось: ${todayTasks.length - done}`);
});

// ===== API endpoints for the web app to sync tasks =====
app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/sync', (req, res) => {
  const { tasks, profile } = req.body;
  const data = loadData();
  if (Array.isArray(tasks)) data.tasks = tasks;
  if (typeof profile === 'string' && profile.trim()) data.profile = profile;
  saveData(data);
  res.json({ ok: true, count: data.tasks.length });
});

app.get('/tasks', (req, res) => {
  const data = loadData();
  res.json({ tasks: data.tasks || [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Project 47 bot server running on port ' + PORT);
});
