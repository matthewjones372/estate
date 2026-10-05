# estate.yaml: one of
ai: { provider: anthropic, apiKey: "${ANTHROPIC_API_KEY}", model: claude-opus-5-5 }
ai: { provider: openai, apiKey: "${OPENAI_API_KEY}", model: <the model> }
ai: { provider: xai, apiKey: "${XAI_API_KEY}", model: grok-4 }  # xAI OpenAI-compatible API
ai: { provider: gemini, apiKey: "${GEMINI_API_KEY}", model: gemini-2.5-flash }  # or GOOGLE_API_KEY
ai: { provider: openai-compatible, url: http://vllm.ai:8000/v1, model: <the model> }  # self-hosted: vLLM, Ollama, LiteLLM
