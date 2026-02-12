const form = document.getElementById("analyze-form");
const submitBtn = document.getElementById("submit-btn");
const resultEl = document.getElementById("result");
const metaEl = document.getElementById("meta");
const followupForm = document.getElementById("followup-form");
const followupInput = document.getElementById("followup-input");
const followupBtn = document.getElementById("followup-btn");
const selfBaziInput = document.getElementById("selfBazi");
const fatherBaziInput = document.getElementById("fatherBazi");
const motherBaziInput = document.getElementById("motherBazi");
const fillExampleBtn = document.getElementById("fill-example-btn");

if (window.marked) {
  window.marked.setOptions({ breaks: true });
}

const conversation = [];
let isRequesting = false;
let renderPending = false;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMarkdown(text) {
  const raw = String(text || "");
  if (window.marked && window.DOMPurify) {
    return window.DOMPurify.sanitize(window.marked.parse(raw));
  }
  return `<p>${escapeHtml(raw).replaceAll("\n", "<br>")}</p>`;
}

function scheduleRenderConversation() {
  if (renderPending) {
    return;
  }
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderConversation();
  });
}

function renderConversation() {
  if (conversation.length === 0) {
    resultEl.textContent = "请先提交信息。";
    return;
  }

  const html = conversation
    .map((message) => {
      const isUser = message.role === "user";
      const roleLabel = isUser ? "你" : "助手";
      const body = isUser
        ? `<p>${escapeHtml(message.content).replaceAll("\n", "<br>")}</p>`
        : renderMarkdown(message.content);
      return [
        `<article class="msg ${isUser ? "msg-user" : "msg-assistant"}">`,
        `<header class="msg-role">${roleLabel}</header>`,
        `<div class="msg-body">${body}</div>`,
        `</article>`
      ].join("");
    })
    .join("");

  resultEl.innerHTML = html;
  resultEl.scrollTop = resultEl.scrollHeight;
}

function hasAssistantReply() {
  return conversation.some((item) => item.role === "assistant" && String(item.content || "").trim());
}

function updateFollowupState() {
  const enabled = hasAssistantReply() && !isRequesting;
  followupInput.disabled = !enabled;
  followupBtn.disabled = !enabled || !String(followupInput.value || "").trim();
}

function setBusyState(busy) {
  isRequesting = busy;
  submitBtn.disabled = busy;
  submitBtn.textContent = busy ? "分析中..." : "生成分析";
  updateFollowupState();
}

function parseChunkPayload(data) {
  if (typeof data === "string") {
    return { kind: "content", text: data };
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  const directText = data.text;
  if (typeof directText === "string" && directText.length > 0) {
    return { kind: String(data.kind || "content"), text: directText };
  }

  const delta = data?.choices?.[0]?.delta;
  if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0) {
    return { kind: "reasoning", text: delta.reasoning_content };
  }

  if (typeof delta?.content === "string" && delta.content.length > 0) {
    return { kind: "content", text: delta.content };
  }

  return null;
}

function parseSseEventBlock(block) {
  const lines = block.split(/\r?\n/);
  let eventName = "message";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  const dataRaw = dataLines.join("\n");
  let data = null;
  if (dataRaw) {
    try {
      data = JSON.parse(dataRaw);
    } catch {
      data = { raw: dataRaw };
    }
  }

  return { event: eventName, data };
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

function buildInitialUserPrompt(payload) {
  const thisYear = new Date().getFullYear();
  return [
    "帮我用铁板神算算一下我的命运。",
    `出生信息：${payload.selfBazi}。`,
    `母亲：${payload.motherBazi}。`,
    `父亲：${payload.fatherBazi}。`,
    `兄弟姐妹：${payload.siblings}。`,
    `婚姻状况：${payload.maritalStatus}。`,
    `补充说明：${payload.note || "无"}。`,
    `今年是${thisYear}年，请结合当前年份分析，并给出可执行建议。`
  ].join("\n");
}

function toHistoryPayload(items) {
  return items
    .filter((item) => (item.role === "user" || item.role === "assistant") && String(item.content || "").trim())
    .slice(-16)
    .map((item) => ({ role: item.role, content: String(item.content) }));
}

function setBaziFields(selfValue, fatherValue, motherValue, onlyWhenEmpty = false) {
  const pairs = [
    [selfBaziInput, selfValue],
    [fatherBaziInput, fatherValue],
    [motherBaziInput, motherValue]
  ];

  for (const [input, nextValue] of pairs) {
    if (!input) continue;
    const current = String(input.value || "").trim();
    if (onlyWhenEmpty && current) continue;
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function hasAnyBaziValue() {
  return [selfBaziInput, fatherBaziInput, motherBaziInput].some((input) => String(input?.value || "").trim());
}

async function requestAnalyzeStream(payload, handlers = {}) {
  const response = await fetch("/api/analyze-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const maybeJson = await response.json().catch(() => null);
    throw new Error(maybeJson?.error || "流式请求失败");
  }

  if (!response.body) {
    throw new Error("当前环境不支持流式响应");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let merged = "";
  let reasoningMerged = "";
  let donePayload = null;
  let metaPayload = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const split = splitSseBlocks(sseBuffer);
    sseBuffer = split.rest;

    for (const block of split.blocks) {
      const { event, data } = parseSseEventBlock(block);

      if (event === "meta") {
        metaPayload = data;
        handlers.onMeta?.(data);
        continue;
      }

      if (event === "chunk") {
        const parsedChunk = parseChunkPayload(data);
        if (!parsedChunk) continue;

        if (parsedChunk.kind === "reasoning") {
          reasoningMerged += parsedChunk.text;
        } else {
          merged += parsedChunk.text;
        }

        handlers.onChunk?.(parsedChunk.kind, parsedChunk.text, merged || reasoningMerged);
        continue;
      }

      if (event === "done") {
        donePayload = data;
        continue;
      }

      if (event === "error") {
        throw new Error(data?.error || "流式分析失败");
      }
    }
  }

  if (donePayload) {
    if (!donePayload.analysis && merged) donePayload.analysis = merged;
    if (!donePayload.analysis && reasoningMerged) donePayload.analysis = reasoningMerged;
    return donePayload;
  }

  return {
    model: metaPayload?.model,
    disclaimer: metaPayload?.disclaimer,
    analysis: merged || reasoningMerged
  };
}

async function requestAnalyzeOnce(payload) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "请求失败");
  }
  return data;
}

async function runModelRequest(payload, assistantIndex) {
  let streamError = null;
  let modelName = "";
  let disclaimer = "";
  let liveText = "";

  try {
    const data = await requestAnalyzeStream(payload, {
      onMeta: (meta) => {
        modelName = String(meta?.model || "");
        disclaimer = String(meta?.disclaimer || "");
        metaEl.textContent = `模型：${modelName || "-"}${disclaimer ? ` | ${disclaimer}` : ""}`;
      },
      onChunk: (_kind, _piece, mergedText) => {
        liveText = mergedText;
        conversation[assistantIndex].content = liveText;
        scheduleRenderConversation();
      }
    });

    modelName = String(data?.model || modelName);
    disclaimer = String(data?.disclaimer || disclaimer);
    conversation[assistantIndex].content = String(data?.analysis || liveText || "模型未返回内容");
  } catch (error) {
    streamError = error instanceof Error ? error.message : "未知错误";
    const data = await requestAnalyzeOnce(payload);
    modelName = String(data?.model || "");
    disclaimer = String(data?.disclaimer || "");
    conversation[assistantIndex].content = String(data?.analysis || "模型未返回内容");
  }

  const metaParts = [];
  if (modelName || disclaimer) {
    metaParts.push(`模型：${modelName || "-"}`);
    if (disclaimer) metaParts.push(disclaimer);
  }
  if (streamError) {
    metaParts.push(`流式降级：${streamError}`);
  }
  metaEl.textContent = metaParts.join(" | ");
  renderConversation();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isRequesting) return;

  const formData = new FormData(form);
  const payloadBase = {
    nickname: String(formData.get("nickname") || "").trim(),
    selfBazi: String(formData.get("selfBazi") || "").trim(),
    fatherBazi: String(formData.get("fatherBazi") || "").trim(),
    motherBazi: String(formData.get("motherBazi") || "").trim(),
    siblings: String(formData.get("siblings") || "").trim(),
    maritalStatus: String(formData.get("maritalStatus") || "").trim(),
    note: String(formData.get("note") || "").trim()
  };

  const userPrompt = buildInitialUserPrompt(payloadBase);
  const payload = { ...payloadBase, userPrompt };

  conversation.length = 0;
  conversation.push({ role: "user", content: userPrompt });
  conversation.push({ role: "assistant", content: "正在分析中..." });
  renderConversation();
  metaEl.textContent = "";

  try {
    setBusyState(true);
    await runModelRequest(payload, 1);
  } catch (error) {
    conversation[1].content = `发生错误：${error instanceof Error ? error.message : "未知错误"}`;
    renderConversation();
  } finally {
    setBusyState(false);
  }
});

followupInput.addEventListener("input", () => {
  updateFollowupState();
});

followupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isRequesting) return;

  const followUp = String(followupInput.value || "").trim();
  if (!followUp) {
    return;
  }

  const history = toHistoryPayload(conversation);
  const payload = { history, followUp };

  followupInput.value = "";
  conversation.push({ role: "user", content: followUp });
  conversation.push({ role: "assistant", content: "正在继续分析..." });
  renderConversation();

  const assistantIndex = conversation.length - 1;

  try {
    setBusyState(true);
    await runModelRequest(payload, assistantIndex);
  } catch (error) {
    conversation[assistantIndex].content = `发生错误：${error instanceof Error ? error.message : "未知错误"}`;
    renderConversation();
  } finally {
    setBusyState(false);
  }
});

fillExampleBtn?.addEventListener("click", () => {
  if (hasAnyBaziValue()) {
    setBaziFields("", "", "");
    return;
  }
  setBaziFields("1995年农历八月初三 19点，男", "1971年农历六月十九", "1971年农历四月二十七");
});

updateFollowupState();
