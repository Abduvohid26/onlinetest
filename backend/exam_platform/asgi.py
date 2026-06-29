import os
from pathlib import Path

import django
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "exam_platform.settings")
django.setup()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402
from django.core.asgi import get_asgi_application  # noqa: E402

from apps.api.routing import websocket_urlpatterns  # noqa: E402


async def lifespan_app(scope, receive, send):
    """ASGI lifespan (startup/shutdown) no-op handler.

    Django/Channels lifespan hodisalarini ishlatmaydi; buni ochiq boshqarmasak
    uvicorn "ASGI 'lifespan' protocol appears unsupported" deb log yozadi.
    Bu handler shu xabarni yo'qotadi (funksional o'zgarish yo'q).
    """
    while True:
        message = await receive()
        if message["type"] == "lifespan.startup":
            await send({"type": "lifespan.startup.complete"})
        elif message["type"] == "lifespan.shutdown":
            await send({"type": "lifespan.shutdown.complete"})
            return


application = ProtocolTypeRouter({
    "lifespan": lifespan_app,
    "http": get_asgi_application(),
    "websocket": AllowedHostsOriginValidator(
        URLRouter(websocket_urlpatterns)
    ),
})
