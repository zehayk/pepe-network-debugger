import sys
from pathlib import Path


def _icon_path() -> str:
    if getattr(sys, 'frozen', False):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).parent.parent / 'client' / 'resources'
    return str(base / 'pepe.ico')


def run_tray(on_quit):
    """Show a system tray icon. Blocks the calling thread until quit."""
    import pystray
    from PIL import Image

    image = Image.open(_icon_path())
    icon = pystray.Icon(
        'PEPE',
        image,
        'PEPE Background Network Sniffer',
        menu=pystray.Menu(
            pystray.MenuItem(
                'Quit PEPE Background Network Sniffer',
                lambda icon, item: (icon.stop(), on_quit()),
            )
        ),
    )
    icon.run()
