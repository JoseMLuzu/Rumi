"""Test browsers use the same CSRF/bootstrap flow as React; no server-side bypass."""

from flask.testing import FlaskClient
from werkzeug.security import generate_password_hash

PASSWORD = "test-only password phrase"
PASSWORD_HASH = generate_password_hash(PASSWORD)


class AccountClient(FlaskClient):
    def open(self, *args, **kwargs):
        if kwargs.get("method", "GET") in {"POST", "PUT", "PATCH", "DELETE"}:
            headers = dict(kwargs.get("headers") or {})
            if "X-CSRF-Token" not in headers:
                bootstrap = super().open("/api/auth/session", method="GET")
                headers["X-CSRF-Token"] = bootstrap.json["csrfToken"]
            kwargs["headers"] = headers
        return super().open(*args, **kwargs)

    def register(self, name, **kwargs):
        return self.post(
            "/api/auth/register", json={"username": name, "password": PASSWORD}, **kwargs
        )

    def login(self, name, **kwargs):
        return self.post("/api/auth/login", json={"username": name, "password": PASSWORD}, **kwargs)


def connect(socketio, app, **kwargs):
    client = kwargs.get("flask_test_client")
    if client:
        kwargs["auth"] = {
            **kwargs.get("auth", {}),
            "csrfToken": client.get("/api/auth/session").json["csrfToken"],
        }
    return socketio.test_client(app, **kwargs)
