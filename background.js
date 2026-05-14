const DEFAULT_PROMPT =
  "You are an intelligent autocomplete assistant. " +
  "Complete the following text naturally and concisely. " +
  "Return ONLY the completion — the part that comes AFTER the existing text — " +
  "with no explanation, no quotes, and no repetition of the input. " +
  "If the text appears complete, return an empty string.\n\n" +
  "{{page_context}}" +
  "Text to complete:\n```\n{{context_string}}\n```";

const DEFAULTS = {
  apiKey: "",
  model: "openai/gpt-4o-mini",
  mainPrompt: DEFAULT_PROMPT,
  temperature: 0.3,
  maxTokens: 150,
  contextSelector: "",
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "complete") {
    handleCompletion(message.contextString, message.pageContext)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // keep message channel open for async response
  }
});

async function handleCompletion(contextString, pageContext) {
  const settings = await chrome.storage.sync.get(DEFAULTS);

  if (!settings.apiKey) {
    return {
      success: false,
      error: "No API key set. Open Kompleter settings.",
    };
  }

  const pageContextBlock = pageContext
    ? `[context]\n${pageContext}\n[/context]\n\n`
    : "";

  const userContent = settings.mainPrompt
    .replace("{{page_context}}", pageContextBlock)
    .replace("{{context_string}}", contextString);

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/kompleter-extension",
        "X-Title": "Kompleter",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: userContent }],
        temperature: Number(settings.temperature),
        max_tokens: Number(settings.maxTokens),
        reasoning: { effort: "minimal", exclude: true },
      }),
    },
  );

  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const errData = await response.json();
      errMsg = errData.error?.message || errMsg;
    } catch (_) {
      /* ignore */
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  return { success: true, text };
}
