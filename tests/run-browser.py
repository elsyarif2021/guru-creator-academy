import subprocess
import socket
import time
import runpy

server = subprocess.Popen(['node', 'tests/helpers/serve.mjs'])
try:
    for _ in range(50):
        try:
            with socket.create_connection(('127.0.0.1', 4173), timeout=.2):
                break
        except OSError:
            time.sleep(.1)
    runpy.run_path('tests/browser.py', run_name='__main__')
finally:
    server.terminate()
    server.wait(timeout=5)
