# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_data_files

block_cipher = None

mitm_datas, mitm_binaries, mitm_hiddenimports = collect_all('mitmproxy')
pystray_datas, pystray_binaries, pystray_hiddenimports = collect_all('pystray')
pil_datas, pil_binaries, pil_hiddenimports = collect_all('PIL')

a = Analysis(
    ['service.py'],
    pathex=[],
    binaries=mitm_binaries + pystray_binaries + pil_binaries,
    datas=(
        mitm_datas + pystray_datas + pil_datas
        + [('../client/resources/pepe.ico', '.')]
    ),
    hiddenimports=(
        mitm_hiddenimports + pystray_hiddenimports + pil_hiddenimports
        + [
            # pywin32
            'win32serviceutil', 'win32service', 'win32event', 'win32api',
            'win32con', 'winerror', 'pywintypes', 'pythoncom', 'win32timezone',
            'servicemanager',
            # uvicorn internals
            'uvicorn.logging',
            'uvicorn.loops', 'uvicorn.loops.asyncio',
            'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto',
            'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto',
            'uvicorn.lifespan', 'uvicorn.lifespan.on',
            # mitmproxy extras
            'mitmproxy.addons', 'mitmproxy.net.check',
            # fastapi / pydantic
            'anyio._backends._asyncio',
        ]
    ),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='pepe-service',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='../client/resources/pepe.ico',
)
