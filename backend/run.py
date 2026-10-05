from .app import app
from .realtime import socketio


if __name__ == "__main__":
    # Socket.IO needs its own runner to support the persistent WebSocket connection.
    # Bind locally, with the debugger/reloader off: reconnects can be tested explicitly.
    socketio.run(app, host="127.0.0.1", port=5001, debug=False, allow_unsafe_werkzeug=True)
