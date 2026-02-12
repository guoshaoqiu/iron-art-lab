import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL_NAME = process.env.MODEL_NAME || "deepseek-chat";
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 1200);
const SYSTEM_PROMPT = (process.env.SYSTEM_PROMPT || "").trim();

const DISCLAIMER = "以下内容仅供娱乐与参考，不构成医学、法律、金融、心理或人生重大决策建议。";
const MAX_HISTORY_MESSAGES = 16;

const TEMPLATE_SCHEMA = {
  schema_version: "1.0",
  subject: {
    gender: null,
    birth_lunar: null,
    birth_solar: null,
    chronology: null
  },
  bazi: {
    year: { stem: null, branch: null, stem_branch: null, wuxing: null, shishen: null },
    month: { stem: null, branch: null, stem_branch: null, wuxing: null, shishen: null },
    day: { stem: null, branch: null, stem_branch: null, wuxing: null, shishen: null },
    hour: { stem: null, branch: null, stem_branch: null, wuxing: null, shishen: null }
  },
  day_master: {
    element: null,
    strength: null,
    likes: null,
    dislikes: null
  },
  four_pillars_shishen: {
    year: null,
    month: null,
    day: null,
    hour: null
  },
  hidden_stems: {},
  parents_info: {
    father_birth_lunar: null,
    father_zodiac: null,
    mother_birth_lunar: null,
    mother_zodiac: null,
    parent_same_zodiac: null
  },
  siblings: {
    total: null,
    gender: null,
    position: null
  },
  marriage_status: null,
  great_luck: {
    current_age: null,
    current_luck_start_year: null,
    current_luck_end_year: null,
    current_pillar: {
      stem: null,
      branch: null,
      stem_branch: null,
      wuxing: null
    },
    previous_luck: null,
    next_luck: null,
    luck_start_age: null,
    yin_yang_gender: null,
    direction: null
  },
  current_year: {
    year: null,
    lunar_year: null,
    age_virtual: null,
    age_nominal: null,
    flow_stem_branch: null,
    flow_wuxing: null,
    conflict: null,
    special_aspect: null
  },
  tieban_custom_params: {
    verified_ke: null,
    gua: null,
    tieban_codes: []
  },
  prediction_summary: {
    career_peak_start: null,
    marriage_likely_years: [],
    special_warning_year: null,
    long_term_potential: null
  }
};

const TEMPLATE_SCHEMA_STR = JSON.stringify(TEMPLATE_SCHEMA);

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    const url = new URL(req.url || "/", `http://${host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return serveFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname.startsWith("/public/")) {
      const safePath = path.normalize(url.pathname.replace(/^\/public\//, ""));
      const fullPath = path.resolve(PUBLIC_DIR, safePath);
      if (!fullPath.startsWith(PUBLIC_DIR)) {
        return sendJson(res, 400, { error: "非法路径" });
      }

      return serveFile(res, fullPath, getContentType(fullPath));
    }

    if (req.method === "POST" && url.pathname === "/api/analyze-stream") {
      if (!DEEPSEEK_API_KEY) {
        return sendJson(res, 500, { error: "服务端未配置 DEEPSEEK_API_KEY" });
      }

      const body = await parseJsonBody(req);
      const validation = validatePayload(body);
      if (!validation.ok) {
        return sendJson(res, 400, { error: validation.message });
      }

      const messages = buildMessages(body);
      beginSse(res);
      sendSse(res, "meta", {
        disclaimer: DISCLAIMER,
        model: MODEL_NAME
      });

      try {
        const result = await callDeepSeekStream(messages, (chunk) => {
          sendSse(res, "chunk", chunk);
        });

        sendSse(res, "done", {
          disclaimer: DISCLAIMER,
          model: MODEL_NAME,
          analysis: result.raw
        });
      } catch (error) {
        console.error("[stream] analyze failed:", error);
        const message = error instanceof Error ? error.message : "流式分析失败";
        sendSse(res, "error", { error: message });
      } finally {
        res.end();
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      if (!DEEPSEEK_API_KEY) {
        return sendJson(res, 500, { error: "服务端未配置 DEEPSEEK_API_KEY" });
      }

      const body = await parseJsonBody(req);
      const validation = validatePayload(body);
      if (!validation.ok) {
        return sendJson(res, 400, { error: validation.message });
      }

      const messages = buildMessages(body);
      const result = await callDeepSeek(messages);

      return sendJson(res, 200, {
        disclaimer: DISCLAIMER,
        model: MODEL_NAME,
        analysis: result.raw
      });
    }

    sendJson(res, 404, { error: "Not Found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务器异常";
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`IronArtLab running at http://localhost:${PORT}`);
});

async function callDeepSeek(messages) {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(buildDeepSeekBody(messages, false))
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek 请求失败: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("DeepSeek 未返回有效分析内容");
  }

  const raw = String(content).trim();
  return {
    raw
  };
}

async function callDeepSeekStream(messages, onChunk) {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(buildDeepSeekBody(messages, true))
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek 请求失败: ${response.status} ${text}`);
  }

  if (!response.body) {
    throw new Error("DeepSeek 流式响应体为空");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let fullText = "";
  let reasoningText = "";
  let done = false;

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    if (readerDone) {
      break;
    }

    sseBuffer += decoder.decode(value, { stream: true });
    const split = splitSseBlocks(sseBuffer);
    sseBuffer = split.rest;

    for (const block of split.blocks) {
      const dataLines = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      for (const line of dataLines) {
        if (!line) {
          continue;
        }

        if (line === "[DONE]") {
          done = true;
          break;
        }

        const parsed = safeJsonParse(line);
        if (!parsed) {
          continue;
        }

        const delta = parsed?.choices?.[0]?.delta;
        const reasoningPiece = delta?.reasoning_content;
        if (typeof reasoningPiece === "string" && reasoningPiece.length > 0) {
          reasoningText += reasoningPiece;
          onChunk({ kind: "reasoning", text: reasoningPiece });
        }

        const contentPiece = delta?.content;
        if (typeof contentPiece === "string" && contentPiece.length > 0) {
          fullText += contentPiece;
          onChunk({ kind: "content", text: contentPiece });
        }
      }

      if (done) {
        break;
      }
    }
  }

  const raw = (fullText || reasoningText).trim();
  return {
    raw
  };
}

function buildDeepSeekBody(messages, stream) {
  const body = {
    model: MODEL_NAME,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages
  };

  if (MODEL_NAME === "deepseek-chat") {
    body.temperature = 1;
  }

  if (stream) {
    body.stream = true;
  }

  return body;
}

function splitSseBlocks(buffer) {
  const blocks = [];
  let rest = buffer;

  while (rest.length > 0) {
    const unixSep = rest.indexOf("\n\n");
    const windowsSep = rest.indexOf("\r\n\r\n");

    let index = -1;
    let sepLen = 0;

    if (unixSep !== -1 && windowsSep !== -1) {
      index = Math.min(unixSep, windowsSep);
      sepLen = index === windowsSep ? 4 : 2;
    } else if (unixSep !== -1) {
      index = unixSep;
      sepLen = 2;
    } else if (windowsSep !== -1) {
      index = windowsSep;
      sepLen = 4;
    }

    if (index === -1) {
      break;
    }

    blocks.push(rest.slice(0, index));
    rest = rest.slice(index + sepLen);
  }

  return { blocks, rest };
}

function beginSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function parseTemplateContent(content) {
  if (typeof content !== "string") {
    return null;
  }

  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const candidates = [cleaned];

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    candidates.push(fenceMatch[1].trim());
  }

  const extracted = extractFirstJsonObject(cleaned);
  if (extracted) {
    candidates.push(extracted);
  }

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return coerceTemplate(parsed);
    }
  }

  return null;
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function safeJsonParse(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function coerceTemplate(source) {
  const merged = mergeByTemplate(TEMPLATE_SCHEMA, source);
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) {
    return null;
  }

  return merged;
}

function mergeByTemplate(template, source) {
  if (Array.isArray(template)) {
    return Array.isArray(source) ? source : [...template];
  }

  if (template === null || typeof template !== "object") {
    return source === undefined ? template : source;
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    source = {};
  }

  const result = {};

  for (const key of Object.keys(template)) {
    result[key] = mergeByTemplate(template[key], source[key]);
  }

  for (const [key, value] of Object.entries(source)) {
    if (!(key in result)) {
      result[key] = value;
    }
  }

  return result;
}

function buildMessages(payload) {
  const history = normalizeHistory(payload.history);
  const messages = [...history];
  if (SYSTEM_PROMPT) {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }
  const followUp = typeof payload.followUp === "string" ? payload.followUp.trim() : "";
  const userPrompt = typeof payload.userPrompt === "string" ? payload.userPrompt.trim() : "";

  if (followUp) {
    messages.push({ role: "user", content: followUp });
    return messages;
  }

  if (userPrompt) {
    messages.push({ role: "user", content: userPrompt });
    return messages;
  }

  messages.push({ role: "user", content: buildInitialPrompt(payload) });
  return messages;
}

function buildInitialPrompt(payload) {
  const thisYear = new Date().getFullYear();
  return [
    "帮我用铁板神算算一下我的命运。",
    `昵称：${payload.nickname}。`,
    `出生信息：${payload.selfBazi}。`,
    `母亲信息：${payload.motherBazi}。`,
    `父亲信息：${payload.fatherBazi}。`,
    `兄弟姐妹情况：${payload.siblings}。`,
    `婚姻状况：${payload.maritalStatus}。`,
    `补充说明：${payload.note || "无"}。`,
    `今年是${thisYear}年，请结合当前年份分析，并给出可执行建议。`
  ].join("\n");
}

function normalizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  return rawHistory
    .slice(-MAX_HISTORY_MESSAGES)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
      const content = typeof item.content === "string" ? item.content.trim() : "";
      if (!role || !content) return null;
      return { role, content: truncateText(content, 4000) };
    })
    .filter(Boolean);
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function validatePayload(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "请求体格式错误" };
  }

  const followUp = typeof body.followUp === "string" ? body.followUp.trim() : "";
  if (followUp) {
    if (followUp.length > 800) {
      return { ok: false, message: "追问内容过长" };
    }
    if (!Array.isArray(body.history) || body.history.length === 0) {
      return { ok: false, message: "缺少对话历史，无法追问。请先进行首次分析" };
    }
    return { ok: true };
  }

  if (body.userPrompt && typeof body.userPrompt === "string") {
    const prompt = body.userPrompt.trim();
    if (!prompt) {
      return { ok: false, message: "userPrompt 不能为空" };
    }
    if (prompt.length > 4000) {
      return { ok: false, message: "userPrompt 过长" };
    }
    return { ok: true };
  }

  const required = ["nickname", "selfBazi", "fatherBazi", "motherBazi", "siblings", "maritalStatus"];
  for (const key of required) {
    const value = body[key];
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false, message: `字段 ${key} 不能为空` };
    }
    if (value.length > 500) {
      return { ok: false, message: `字段 ${key} 内容过长` };
    }
  }

  if (body.note && typeof body.note === "string" && body.note.length > 1200) {
    return { ok: false, message: "补充说明内容过长" };
  }

  return { ok: true };
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

async function serveFile(res, filePath, contentType) {
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "文件不存在" });
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function getContentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function loadEnv(envPath) {
  try {
    const envRaw = fsSync.readFileSync(envPath, "utf-8");
    const lines = envRaw.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();

      if (key && process.env[key] === undefined) {
        process.env[key] = stripQuotes(value);
      }
    }
  } catch {
    // .env is optional
  }
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
