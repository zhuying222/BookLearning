import logging
import time

import httpx

from app.core.redaction import redact_sensitive_text
from app.models.ai_config import AiConfig
from app.services.prompt_service import get_prompt_config

logger = logging.getLogger(__name__)


async def call_vision_model(
    config: AiConfig,
    image_base64: str,
    page_prompt: str | None = None,
    context_summary: str | None = None,
) -> str:
    prompt_config = get_prompt_config()

    system_prompt = prompt_config.system_prompt
    if context_summary:
        system_prompt += f"\n\n前文摘要（供参考，保持讲解连贯）：\n{context_summary}"

    user_text = page_prompt or prompt_config.user_prompt_template

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user_text},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                },
            ],
        },
    ]

    # 兼容 base_url 末尾带或不带 /v1
    base = config.base_url.rstrip("/")
    if base.endswith("/v1"):
        url = base + "/chat/completions"
    else:
        url = base + "/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": config.model_name,
        "messages": messages,
        "max_tokens": config.max_tokens,
        "temperature": config.temperature,
    }

    t0 = time.monotonic()
    logger.info("AI call start model=%s url=%s", config.model_name, url)

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            response = await client.post(url, json=payload, headers=headers)
        except httpx.ConnectError:
            logger.error("AI connect error url=%s elapsed=%.1fs", url, time.monotonic() - t0)
            raise RuntimeError(f"Cannot connect to AI service at {url}")
        except httpx.TimeoutException:
            logger.error("AI timeout url=%s elapsed=%.1fs", url, time.monotonic() - t0)
            raise RuntimeError(f"AI service timeout (120s) at {url}")

        elapsed = time.monotonic() - t0
        if response.status_code != 200:
            logger.error("AI error status=%d model=%s elapsed=%.1fs", response.status_code, config.model_name, elapsed)
            detail = redact_sensitive_text(response.text[:300])
            raise RuntimeError(
                f"AI service returned {response.status_code}: {detail}"
            )

    data = response.json()
    try:
        result = data["choices"][0]["message"]["content"]
        logger.info("AI call success model=%s elapsed=%.1fs chars=%d", config.model_name, elapsed, len(result))
        return result
    except (KeyError, IndexError):
        logger.error("AI unexpected response model=%s elapsed=%.1fs", config.model_name, elapsed)
        raise RuntimeError(f"Unexpected AI response format: {redact_sensitive_text(str(data)[:300])}")
