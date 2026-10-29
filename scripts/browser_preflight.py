"""Read-only macOS launch-services permission check before browser tests."""
import ctypes
import os
import sys

SERVICES = (b'com.apple.coreservices.launchservicesd', b'com.apple.lsd.mapdb',
            b'com.apple.windowserver.active')
MESSAGE = ('Browser tests unavailable: macOS sandbox denies or cannot verify LaunchServices/WindowServer access. '
           'Rerun from an ordinary terminal or another environment that permits browser launch: '
           'python3 scripts/check_project.py --only connector-sidebar connector-workspace connector-ai-settings '
           '(or cd papermind-zotero && npm run test:browser).')


def browser_preflight():
    if sys.platform != 'darwin':
        return None
    try:
        lib = ctypes.CDLL('/usr/lib/system/libsystem_sandbox.dylib', use_errno=True)
        check = lib.sandbox_check
        # The final service parameter is variadic. Fixed argtypes are required on Apple ARM64.
        check.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
        check.restype = ctypes.c_int
        flags = 2 | ctypes.c_int.in_dll(lib, 'SANDBOX_CHECK_NO_REPORT').value
        for service in SERVICES:
            result = check(os.getpid(), b'mach-lookup', flags, ctypes.c_char_p(service))
            if result != 0:
                return MESSAGE + ' Service: ' + service.decode() + '; result: ' + str(result)
    except (OSError, AttributeError, ValueError) as error:
        return MESSAGE + ' Preflight error: ' + str(error)
    return None


if __name__ == '__main__':
    error = browser_preflight()
    if error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
