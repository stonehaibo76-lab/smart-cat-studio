import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT, DEFAULT_LOCAL_LLM_MODEL } from '../constants';
import { QAIssue, AISettings } from '../types';
import { withAiConcurrency } from './aiConcurrency';
import { hasMarkerTags } from './xliff/markerTags';
import {
  checkLocalLlmHealth,
  localLlmChatCompletions,
  resolveLocalLlmBaseUrl,
} from './localLlmClient';

/** DeepSeek / Gemini / 本地 LLM 单次生成超时（毫秒） */
const OPENAI_COMPAT_FETCH_TIMEOUT_MS = 180_000;
const GEMINI_GENERATE_TIMEOUT_MS = 180_000;

function geminiAbortSignal(): AbortSignal {
  return AbortSignal.timeout(GEMINI_GENERATE_TIMEOUT_MS);
}

let geminiAi: GoogleGenAI | null = null;

try {
  if (process.env.API_KEY) {
    geminiAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
} catch (error) {
  console.error("Failed to initialize GoogleGenAI", error);
}

// --- OpenAI-compatible API (DeepSeek / local via proxy) ---
const callOpenAICompatible = async (
  baseUrl: string,
  apiKey: string,
  prompt: string,
  systemPrompt: string = SYSTEM_PROMPT,
  jsonMode: boolean = false,
  model: string = "deepseek-chat",
  deepSeekExtras?: { isDeepSeekV4Pro?: boolean }
): Promise<string> => {
  const root = baseUrl.replace(/\/+$/, '');
  const isDeepSeekV4Pro = deepSeekExtras?.isDeepSeekV4Pro ?? model === 'deepseek-v4-pro';
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ],
    response_format: jsonMode ? { type: "json_object" } : undefined,
    temperature: 0.3,
  };
  if (isDeepSeekV4Pro) {
    body.reasoning_effort = "high";
    body.extra_body = { thinking: { type: "enabled" } };
  }

  const response = await fetch(`${root}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(OPENAI_COMPAT_FETCH_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API Error: ${response.status} - ${err}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('API 返回格式异常：缺少文本内容');
  }
  return content;
};

const callDeepSeek = async (
  prompt: string,
  apiKey: string,
  systemPrompt: string = SYSTEM_PROMPT,
  jsonMode: boolean = false,
  model: string = "deepseek-chat"
): Promise<string> => {
  try {
    return await callOpenAICompatible(
      "https://api.deepseek.com/v1",
      apiKey,
      prompt,
      systemPrompt,
      jsonMode,
      model,
      { isDeepSeekV4Pro: model === 'deepseek-v4-pro' }
    );
  } catch (e) {
    console.error("DeepSeek Call Failed:", e);
    throw e;
  }
};

const callLocalLlm = async (
  settings: AISettings,
  prompt: string,
  systemPrompt: string = SYSTEM_PROMPT,
  jsonMode: boolean = false,
  model?: string,
  maxTokens: number = 1024
): Promise<string> => {
  return localLlmChatCompletions(settings, {
    model: model || settings.model || DEFAULT_LOCAL_LLM_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ],
    response_format: jsonMode ? { type: "json_object" } : undefined,
    temperature: 0.3,
    max_tokens: maxTokens,
    chat_template_kwargs: { enable_thinking: false },
  });
};

export const testAIConnection = async (
    settings?: AISettings
): Promise<{ ok: boolean; text: string }> => {
    if (!settings) {
        return { ok: false, text: '未检测到 AI 配置。' };
    }

    if (settings.provider === 'deepseek') {
        const apiKey = settings.deepSeekKey?.trim();
        if (!apiKey) {
            return { ok: false, text: '请先填写 DeepSeek API Key。' };
        }
        const model = settings.model || 'deepseek-v4-flash';
        try {
            await callDeepSeek(
                '请仅回复：OK',
                apiKey,
                '你是连接测试助手。',
                false,
                model
            );
            return { ok: true, text: `DeepSeek 连接成功（模型：${model}）。` };
        } catch (e) {
            return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
    }

    if (settings.provider === 'local') {
        const baseUrl = resolveLocalLlmBaseUrl(settings);
        const health = await checkLocalLlmHealth(baseUrl, settings.localLlmApiKey?.trim());
        if (!health.ok) {
            return { ok: false, text: health.error || '无法连接本地 LLM 服务' };
        }
        const model = settings.model || DEFAULT_LOCAL_LLM_MODEL;
        try {
            await callLocalLlm(settings, '请仅回复：OK', '你是连接测试助手。', false, model, 16);
            return { ok: true, text: `本地 LLM 连接成功（${baseUrl}，模型：${model}）。` };
        } catch (e) {
            return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
    }

    if (settings.provider === 'gemini') {
        if (!geminiAi) {
            return { ok: false, text: '未检测到 Gemini API Key（环境变量 API_KEY）。' };
        }
        try {
            await geminiAi.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: '请仅回复：OK',
                config: {
                    temperature: 0,
                    abortSignal: geminiAbortSignal(),
                }
            });
            return { ok: true, text: 'Gemini 连接成功。' };
        } catch (e) {
            return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
    }

    return { ok: false, text: '当前提供商暂不支持连接测试。' };
};

// --- Helper to clean extra quotes from AI responses ---
const cleanQuotes = (text: string): string => {
    if (!text) return text;
    let cleaned = text.trim();
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1);
    }
    if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
        cleaned = cleaned.slice(1, -1);
    }
    return cleaned;
};

// --- Main Translation Service ---

export const translateSegment = async (
  sourceText: string,
  targetLang: string,
  sourceLang: string = 'en',
  additionalContext?: string,
  glossary?: { source: string; target: string }[],
  settings?: AISettings,
  ragContext?: string
): Promise<string> =>
  withAiConcurrency(async () => {
  let prompt = `请将以下文本从 ${sourceLang} 翻译成 ${targetLang}。\n`;
  if (glossary && glossary.length > 0) {
      prompt += `\n[强制术语表 / Mandatory Glossary]:\n请在翻译时严格遵守以下术语定义：\n${glossary.map(t => `- ${t.source} -> ${t.target}`).join('\n')}\n`;
  }
  if (additionalContext) {
      prompt += `\n[翻译风格/背景要求]: ${additionalContext}\n`;
  }
  if (ragContext && ragContext.trim()) {
      prompt += `\n[参考资料 / 知识库检索]:\n${ragContext.trim()}\n\n以上仅供翻译参考；若与强制术语表冲突，必须以术语表为准；无法从参考资料推断时请严格依据原文翻译。\n`;
  }
  if (hasMarkerTags(sourceText)) {
      prompt += `\n[格式标签 — 必须保留]: 原文含有形如 <1>...</1> 的内联格式标签。翻译时必须原样保留所有标签的位置与编号，只翻译标签内外的文字，不得增删、重命名或移动标签。\n`;
  }
  prompt += `\n文本: "${sourceText}"`;

  if (settings?.provider === 'local') {
    const readiness = getAIReadinessError(settings);
    if (readiness) throw new Error(readiness);
    return cleanQuotes(
      await callLocalLlm(settings, prompt, SYSTEM_PROMPT, false, settings.model)
    );
  }

  // 1. Try DeepSeek if configured
  if (settings?.provider === 'deepseek' && settings.deepSeekKey) {
      try {
          return cleanQuotes(await callDeepSeek(prompt, settings.deepSeekKey, SYSTEM_PROMPT, false, settings.model || 'deepseek-v4-flash'));
      } catch (e) {
          console.error("DeepSeek failed, falling back to Gemini if available", e);
          // Fallthrough to Gemini
      }
  }

  // 2. Default to Gemini
  if (!geminiAi) {
    // console.warn("Gemini API not initialized. Using Mock response.");
    await new Promise(resolve => setTimeout(resolve, 300));
    return `[AI-Mock] ${sourceText}`;
  }

  try {
    const response = await geminiAi.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
        abortSignal: geminiAbortSignal(),
      }
    });

    const raw = response.text?.trim();
    if (!raw) {
      throw new Error('Gemini 返回空译文');
    }
    return cleanQuotes(raw);
  } catch (error) {
    console.error("Gemini Translation Error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Gemini 翻译失败：${msg}`);
  }
});

/**
 * 检查当前 AI 提供商是否已配置可用凭证。
 * 返回 null 表示可用；返回字符串表示应提示给用户的错误信息。
 */
export const getAIReadinessError = (settings?: AISettings): string | null => {
  if (!settings) {
    return '未检测到 AI 配置，请先在系统设置中完成配置。';
  }

  if (settings.provider === 'deepseek') {
    if (!settings.deepSeekKey || settings.deepSeekKey.trim() === '') {
      return '未填写 DeepSeek API Key，请先到「系统设置 > AI 引擎」填写后再进行 AI 预翻译。';
    }
    return null;
  }

  // Gemini 通过环境变量初始化；若未初始化则视为未配置。
  if (settings.provider === 'gemini' && !geminiAi) {
    return '未检测到 Gemini API Key，请先配置环境变量 API_KEY 后再进行 AI 预翻译。';
  }

  if (settings.provider === 'openai') {
    return '当前版本暂不支持 OpenAI 预翻译，请切换到 Gemini 或 DeepSeek。';
  }

  if (settings.provider === 'local') {
    if (!resolveLocalLlmBaseUrl(settings)) {
      return '请填写本地 LLM 服务地址（如 http://127.0.0.1:8080/v1），并确保 llama-server 已启动。';
    }
    return null;
  }

  return null;
};

export const polishSegment = async (
    sourceText: string,
    targetText: string,
    targetLang: string,
    additionalContext?: string,
    settings?: AISettings
): Promise<string> =>
    withAiConcurrency(async () => {
    let prompt = `你是一名资深的母语级润色专家。请优化以下译文，使其在 ${targetLang} 中表达更加自然、流畅、地道，同时确保不偏离原文含义。

原文: "${sourceText}"
当前译文: "${targetText}"

`;
    if (additionalContext) {
        prompt += `[风格要求]: ${additionalContext}\n`;
    }
    prompt += `\n请直接输出润色后的译文，不要包含任何解释或引号。`;

    if (settings?.provider === 'local') {
        try {
            return cleanQuotes(
              await callLocalLlm(settings, prompt, SYSTEM_PROMPT, false, settings.model)
            );
        } catch (e) {
            console.error(e);
            return targetText;
        }
    }

    if (settings?.provider === 'deepseek' && settings.deepSeekKey) {
        try {
            return cleanQuotes(await callDeepSeek(prompt, settings.deepSeekKey, SYSTEM_PROMPT, false, settings.model || 'deepseek-v4-flash'));
        } catch (e) { console.error(e); }
    }

    if (!geminiAi) return targetText; // Fallback

    try {
        const response = await geminiAi.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                temperature: 0.4,
                abortSignal: geminiAbortSignal(),
            }
        });
        return cleanQuotes(response.text?.trim() || targetText);
    } catch (e) {
        console.error("Polishing failed", e);
        return targetText;
    }
});

// --- AI Chat Service ---
export const sendAIChatMessage = async (
    history: { role: 'user' | 'model', text: string }[],
    newMessage: string,
    context?: string,
    settings?: AISettings
): Promise<string> =>
    withAiConcurrency(async () => {
    // Construct Prompt History
    const systemInstruction = `你是一个专业的CAT工具AI助手。你的任务是协助翻译人员解决术语、语法或背景知识问题。
    当前项目背景: ${context || '无'}
    请用简洁、专业的语言回答。`;

    if (settings?.provider === 'local') {
        try {
             let prompt = "";
             history.forEach(h => prompt += `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}\n`);
             prompt += `User: ${newMessage}`;
             return await callLocalLlm(settings, prompt, systemInstruction, false, settings.model);
        } catch (e) {
            console.error(e);
            return "AI 暂时无法响应，请稍后再试。";
        }
    }

    if (settings?.provider === 'deepseek' && settings.deepSeekKey) {
        try {
             // DeepSeek format
             let prompt = "";
             history.forEach(h => prompt += `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}\n`);
             prompt += `User: ${newMessage}`;
             return await callDeepSeek(prompt, settings.deepSeekKey, systemInstruction, false, settings.model || 'deepseek-v4-flash');
        } catch (e) { console.error(e); }
    }

    if (!geminiAi) return "AI 服务未连接，无法回答。";

    try {
        // Use Chat Session
        const chat = geminiAi.chats.create({
            model: 'gemini-3-flash-preview',
            config: {
                systemInstruction: systemInstruction,
            },
            history: history.map(h => ({
                role: h.role,
                parts: [{ text: h.text }]
            }))
        });

        const result = await chat.sendMessage({
          message: newMessage,
          config: { abortSignal: geminiAbortSignal() },
        });
        return result.text || "无回答";
    } catch (e) {
        console.error("Chat Error", e);
        return "AI 暂时无法响应，请稍后再试。";
    }
});

export const analyzeProjectContext = async (
    sampleSegments: string[],
    sourceLang: string,
    targetLang: string,
    settings?: AISettings
): Promise<string> =>
    withAiConcurrency(async () => {
    const samples = sampleSegments.slice(0, 30).join('\n');
    const prompt = `你是一位专业的翻译项目经理。请分析以下${sourceLang}源文本片段（最多30句），并总结出适合该项目的翻译风格指南。
    
    源文本片段:
    ---
    ${samples}
    ---

    请简要概括：
    1. 文本所属的专业领域（如IT、医疗、文学等）。
    2. 语体风格（如正式、口语、幽默、严谨等）。
    3. 针对${targetLang}翻译的具体建议（如“使用敬语”、“保留专业术语英文”等）。

    请将所有分析浓缩为一段大约 100 字以内的“AI翻译提示词”，我将把这段提示词发给翻译模型。只返回这段提示词即可。`;

    if (settings?.provider === 'local') {
        try {
            return await callLocalLlm(settings, prompt, SYSTEM_PROMPT, false, settings.model);
        } catch (e) {
            console.error(e);
            return "保持专业、准确的翻译风格。";
        }
    }

    if (settings?.provider === 'deepseek' && settings.deepSeekKey) {
        try {
            return await callDeepSeek(prompt, settings.deepSeekKey, SYSTEM_PROMPT, false, settings.model || 'deepseek-v4-flash');
        } catch (e) { console.error(e); }
    }

    if (!geminiAi) return "保持专业、准确的翻译风格。";

    try {
        const response = await geminiAi.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                temperature: 0.5,
                abortSignal: geminiAbortSignal(),
            }
        });
        return response.text?.trim() || "保持专业翻译风格。";
    } catch (e) {
        console.error("Context analysis failed", e);
        return "保持专业翻译风格。";
    }
});

export const runDeepQACheck = async (
    sourceText: string,
    targetText: string,
    targetLang: string,
    enabledChecks: string[],
    settings?: AISettings
): Promise<QAIssue[]> =>
    withAiConcurrency(async () => {
    if (enabledChecks.length === 0) return [];

    const prompt = `你是一个专业的CAT工具QA（质量保证）插件。请检查以下译文是否存在选定的问题。

原文: "${sourceText}"
译文: "${targetText}"
目标语言: ${targetLang}

请检查以下项目（如果未列出则忽略）:
${enabledChecks.join('\n')}

请返回一个 JSON 数组，数组中每个对象包含：
- type: "warning" 或 "error"
- category: 问题类别（如 "语义", "逻辑", "风格" 等）
- message: 简短的问题描述

如果没有任何问题，返回空数组 []。
不要输出 Markdown 格式，只输出纯 JSON。`;

    let jsonStr = "[]";

    if (settings?.provider === 'local') {
        try {
            jsonStr = await callLocalLlm(settings, prompt, SYSTEM_PROMPT, true, settings.model, 2048);
        } catch (e) { console.error(e); }
    }
    // 1. Try DeepSeek
    else if (settings?.provider === 'deepseek' && settings.deepSeekKey) {
        try {
            jsonStr = await callDeepSeek(prompt, settings.deepSeekKey, SYSTEM_PROMPT, true, settings.model || 'deepseek-v4-flash');
        } catch (e) { console.error(e); }
    } 
    // 2. Try Gemini
    else if (geminiAi) {
        try {
            const response = await geminiAi.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    temperature: 0.1,
                    abortSignal: geminiAbortSignal(),
                }
            });
            jsonStr = response.text || "[]";
        } catch (e) {
            console.error("Deep QA Check failed", e);
        }
    }

    try {
        const issues = JSON.parse(jsonStr);
        if (Array.isArray(issues)) {
            return issues.map((issue: any) => ({
                id: `qa-ai-${Date.now()}-${Math.random()}`,
                type: issue.type || 'warning',
                category: issue.category || 'AI Check',
                message: issue.message || 'Potential issue detected'
            }));
        }
        return [];
    } catch (parseError) {
        console.warn("Failed to parse QA JSON", parseError);
        return [];
    }
});

// Single segment suggestion (Legacy)
export const generateTermSuggestions = async (
  sourceText: string,
  targetLang: string
): Promise<string[]> => {
    // Legacy support wrapper
    const res = await extractProjectTerms(sourceText, targetLang, ['Technical'], 1);
    return res.map(r => `${r.source} - ${r.target}`);
};

// Full Project Extraction
export interface TermCandidate {
    id: string;
    source: string;
    target: string;
    type: string;
    confidence: number;
}

export const extractProjectTerms = async (
    fullText: string,
    targetLang: string,
    categories: string[],
    threshold: number = 1,
    settings?: AISettings
): Promise<TermCandidate[]> =>
    withAiConcurrency(async () => {
    // Limit text length to prevent token overflow (approx 50 segments or 20k chars)
    const safeText = fullText.slice(0, 20000); 

    const prompt = `你是专业的术语学家。请分析以下文本，提取其中重要的术语，并提供${targetLang}翻译。

提取类别要求: ${categories.join(', ')}。
忽略常用词汇，只关注专业性强或具有特定指代意义的词。

文本内容:
"""
${safeText}
"""

请返回一个 JSON 数组，每个对象包含：
- source: 原文术语
- target: 推荐译文
- type: 术语类别（如 "Technical", "Person", "Location", "Org", "Time" 等）

注意：
1. 尽可能合并单复数形式。
2. 确保提取结果准确，去除停用词。
3. 仅输出 JSON。`;

    let jsonStr = "[]";

     if (settings?.provider === 'local') {
        try {
            jsonStr = await callLocalLlm(settings, prompt, SYSTEM_PROMPT, true, settings.model, 2048);
        } catch (e) { console.error(e); }
    }
     // 1. Try DeepSeek
     else if (settings?.provider === 'deepseek' && settings.deepSeekKey) {
        try {
            jsonStr = await callDeepSeek(prompt, settings.deepSeekKey, SYSTEM_PROMPT, true, settings.model || 'deepseek-v4-flash');
        } catch (e) { console.error(e); }
    } 
    // 2. Try Gemini
    else if (geminiAi) {
        try {
            const response = await geminiAi.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    temperature: 0.1,
                    abortSignal: geminiAbortSignal(),
                }
            });
            jsonStr = response.text || "[]";
        } catch (e) {
            console.error("Term extraction failed", e);
        }
    } else {
        return [];
    }

    try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
            return parsed.map((item: any, idx) => ({
                id: `cand-${Date.now()}-${idx}`,
                source: item.source || "",
                target: item.target || "",
                type: item.type || "General",
                confidence: 0.8 // Dummy confidence for now
            }));
        }
        return [];
    } catch (e) {
        console.error("JSON Parse Error", e);
        return [];
    }
});