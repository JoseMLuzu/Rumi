"""Local administrative invitation for a reserved bedroom; never expose this as an API."""

import argparse
import secrets
import time
from urllib.parse import urlencode
from .auth import digest
from .database import SessionLocal
from .models import Visitor, SpaceMembership
from .visitors import normalize_name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username")
    parser.add_argument("--base-url", default="http://localhost:5173")
    parser.add_argument("--host", action="store_true", help="Explicitly grant living-room editing.")
    args = parser.parse_args()
    username, _ = normalize_name(args.username)
    code = secrets.token_urlsafe(32)
    with SessionLocal.begin() as session:
        user = session.get(Visitor, username)
        if not user or user.password_hash:
            parser.error("Choose an existing reserved name that has no password yet.")
        user.activation_hash = digest(code)
        user.activation_expires_at = time.time() + 24 * 3600
        if args.host:
            user.is_host = True
            member = session.get(SpaceMembership, (1, user.id))
            if member:
                member.is_host = True
    print("Private, one-use link (expires in 24 hours). Share only with this bedroom's owner:")
    print(args.base_url.rstrip("/") + "/#" + urlencode({"activate": code, "username": username}))


if __name__ == "__main__":
    main()
