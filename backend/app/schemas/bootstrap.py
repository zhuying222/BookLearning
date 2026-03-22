from pydantic import BaseModel


class BootstrapResponse(BaseModel):
    app_name: str
    version: str
    frontend_stack: str
    backend_stack: str
    next_focus: list[str]

