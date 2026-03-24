import logging
import re
import time
from dataclasses import dataclass

import httpx

from app.core.redaction import redact_sensitive_text
from app.models.ai_config import AiConfig
from app.services.prompt_service import get_prompt_config

logger = logging.getLogger(__name__)


@dataclass
class CostInfo:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    cost_amount: float | None = None
    cost_unit: str | None = None
    cost_display: str | None = None


async def call_vision_model(
    config: AiConfig,
    image_base64: str,
    page_prompt: str | None = None,
    context_summary: str | None = None,
    extra_system_prompt: str | None = None,
    user_text_override: str | None = None,
) -> tuple[str, CostInfo | None]:
    prompt_config = get_prompt_config()

    system_prompt = prompt_config.system_prompt
    if context_summary:
        system_prompt += f"\n\n前文摘要（供参考，保持讲解连贯）：\n{context_summary}"
    if extra_system_prompt:
        system_prompt += f"\n\n{extra_system_prompt}"

    user_text = user_text_override or page_prompt or prompt_config.user_prompt_template

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
        return result, _extract_cost_info(data)
    except (KeyError, IndexError):
        logger.error("AI unexpected response model=%s elapsed=%.1fs", config.model_name, elapsed)
        raise RuntimeError(f"Unexpected AI response format: {redact_sensitive_text(str(data)[:300])}")


def _extract_cost_info(data: dict) -> CostInfo | None:
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    input_tokens = _to_int(
        usage.get("prompt_tokens")
        or usage.get("input_tokens")
        or usage.get("prompt_token_count")
    )
    output_tokens = _to_int(
        usage.get("completion_tokens")
        or usage.get("output_tokens")
        or usage.get("completion_token_count")
    )
    total_tokens = _to_int(
        usage.get("total_tokens")
        or usage.get("total_token_count")
    )

    cost_source = _find_first_value(
        data,
        {
            "cost",
            "total_cost",
            "request_cost",
            "total_price",
            "price",
        },
    )
    unit_source = _find_first_value(
        data,
        {
            "cost_unit",
            "currency",
            "unit",
            "price_unit",
        },
    )

    cost_amount, cost_unit, cost_display = _normalize_cost(cost_source, unit_source)
    if all(value is None for value in (input_tokens, output_tokens, total_tokens, cost_amount, cost_display)):
        return None

    return CostInfo(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cost_amount=cost_amount,
        cost_unit=cost_unit,
        cost_display=cost_display,
    )


def _find_first_value(node: object, keys: set[str]) -> object | None:
    if isinstance(node, dict):
        for key, value in node.items():
            if key.lower() in keys and value not in (None, ""):
                return value
        for value in node.values():
            found = _find_first_value(value, keys)
            if found not in (None, ""):
                return found
    elif isinstance(node, list):
        for item in node:
            found = _find_first_value(item, keys)
            if found not in (None, ""):
                return found
    return None


def _normalize_cost(cost_value: object, unit_value: object) -> tuple[float | None, str | None, str | None]:
    if cost_value in (None, ""):
        return None, _string_or_none(unit_value), None

    if isinstance(cost_value, (int, float)):
        amount = float(cost_value)
        unit = _string_or_none(unit_value)
        display = f"{unit}{amount:.6f}" if unit else f"{amount:.6f}"
        return amount, unit, display

    if isinstance(cost_value, str):
        raw = cost_value.strip()
        match = re.search(r"([¥$€£])?\s*(-?\d+(?:\.\d+)?)\s*([A-Za-z\u00A5$€£]+)?", raw)
        if not match:
            return None, _string_or_none(unit_value), raw
        amount = float(match.group(2))
        unit = match.group(1) or match.group(3) or _string_or_none(unit_value)
        display = raw
        return amount, unit, display

    return None, _string_or_none(unit_value), str(cost_value)


def _to_int(value: object) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _string_or_none(value: object) -> str | None:
    if value in (None, ""):
        return None
    return str(value).strip() or None
