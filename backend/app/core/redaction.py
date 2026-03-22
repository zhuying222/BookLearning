import re


def mask_secret(value: str, visible_prefix: int = 4, visible_suffix: int = 2) -> str:
    trimmed = value.strip()
    if len(trimmed) <= visible_prefix + visible_suffix:
        return "***"
    return f"{trimmed[:visible_prefix]}***{trimmed[-visible_suffix:]}"


def redact_sensitive_text(text: str) -> str:
    redacted = text

    redacted = re.sub(
        r"(?i)(bearer\s+)([A-Za-z0-9._-]{8,})",
        lambda match: f"{match.group(1)}{mask_secret(match.group(2))}",
        redacted,
    )

    for field_name in ("api_key", "secret", "token", "password"):
        pattern = re.compile(
            rf"(?i)({field_name}\s*[:=]\s*[\"']?)([^\"'\s,]+)"
        )
        redacted = pattern.sub(
            lambda match: f"{match.group(1)}{mask_secret(match.group(2))}",
            redacted,
        )

    redacted = re.sub(
        r"(?i)\b(sk-[A-Za-z0-9_-]{10,})\b",
        lambda match: mask_secret(match.group(1)),
        redacted,
    )

    return redacted
