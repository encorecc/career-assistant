const express = require('express');
const multer = require('multer');
const path = require('path');
const { OpenAI } = require('openai');
try { require('dotenv').config(); } catch (_) {}

const app = express();
app.use(express.json({ limit: '1mb' }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20,
  },
});

const PORT = process.env.PORT || 3000;
const ARK_API_KEY = process.env.ARK_API_KEY || process.env.ARK_API_Key || process.env.ARK_APIKEY;
if (!ARK_API_KEY) {
  console.warn('未检测到 ARK_API_KEY 环境变量（或兼容键 ARK_API_Key / ARK_APIKEY），请在系统中设置。');
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (req, res) => {
  const modelFromEnv = process.env.ARK_MODEL || process.env.ARK_EP_ID || process.env.ARK_ENDPOINT_ID;
  res.json({
    ok: true,
    has_key: !!ARK_API_KEY,
    has_model: !!modelFromEnv,
    port: PORT
  });
});

app.post('/api/analyze', upload.array('images'), async (req, res) => {
  try {
    if (!ARK_API_KEY) {
      return res.status(500).json({ error: '未配置 ARK_API_KEY 环境变量' });
    }
    const client = new OpenAI({
      apiKey: ARK_API_KEY,
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    });
    const files = req.files || [];
    const { stage, age_range, gender_pref, goal, context, extra_text, relation } = req.body || {};
    const textOnly = typeof extra_text === 'string' && extra_text.trim().length > 0;
    if (files.length < 5 && !textOnly) {
      return res.status(400).json({ error: '请至少上传 5 张图片，或切换到“仅文本”并填写内容' });
    }
    const images = files.length > 0
      ? files.map((f) => {
          const mime = f.mimetype || 'image/jpeg';
          const base64 = f.buffer.toString('base64');
          return {
            type: 'input_image',
            image_url: `data:${mime};base64,${base64}`,
          };
        })
      : [];

    const systemPrompt =
      '你是一个职场交涉的高手，对于职场同事或领导的心理和外在表现，有非常强的洞察，也有一套很厉害的处理复杂politics的技巧！擅长于输出简短但有效的分析和建议。';

    const outputSchema = `
按以下 JSON 结构返回：
{
  "summary": {
    "traits": [角色与倾向...],
    "interests": [关注点与诉求...],
    "communication_style": "沟通风格",
    "values": [职场价值与优先级...]
  },
  "recommendations": {
    "openers": [开场与关键措辞...],
    "topics": [交涉议题...],
    "activities": [行动建议...],
    "dos": [应做...],
    "donts": [不宜...]
  },
  "risks": [字符串...],
  "confidence": 数字0-1,
  "disclaimer": "遵循职场伦理与合规的声明"
}`;

    const userContext = `目标=${goal || '未填写'}；阶段=${stage || '未填写'}；年龄范围=${age_range || '未填写'}；性别倾向=${gender_pref || '未填写'}；场景线索=${context || '未填写'}；关系与偏好=${(relation || '').slice(0,300)}；补充文本=${(extra_text || '').slice(0,500)}。`;

    const promptText =
      `${systemPrompt}\n任务：基于用户提供的职场对话截图，快速归纳画像并给出简短有效的交涉建议，目标是在职场场景中推进共同目标，不被低估、不被忽悠（不保证结果）。\n` +
      `重点：保持专业与尊重，以数据与共同目标为中心，避免情绪化与操控式语言；建议要可执行。\n` +
      `${outputSchema}\n` +
      `${userContext}`;

    const contentParts = [{ type: 'input_text', text: promptText }];
    if (textOnly) {
      contentParts.push({ type: 'input_text', text: extra_text });
    }
    contentParts.push(...images);
    const modelFromEnv = process.env.ARK_MODEL || process.env.ARK_EP_ID || process.env.ARK_ENDPOINT_ID;
    if (!modelFromEnv) {
      return res.status(500).json({ error: '未配置 ARK_MODEL 或 ARK_EP_ID 环境变量（请设置为可用的模型名或端点ID，例如 ep-xxxxxxxx）' });
    }
    const response = await client.responses.create({
      model: modelFromEnv,
      input: [
        {
          role: 'user',
          content: contentParts,
        },
      ],
    });

    const text = response?.output_text || '';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    return res.json(parsed);
  } catch (err) {
    console.error('analyze error:', err);
    return res.status(500).json({ error: '服务异常', detail: String(err) });
  }
});

 

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
