"""Small room style records share preset names with React; image bytes stay in storage."""

import json
import re
from pathlib import Path
from .validation import finite_number

OPTIONS = json.loads(
    (Path(__file__).resolve().parents[1] / "src/data/roomAppearance.json").read_text()
)


def default_appearance():
    return {
        surface: {
            "preset": options["default"],
            "color": options["presets"][options["default"]]["color"],
            "image": None,
            "fit": "cover",
            "crop": [0.5, 0.5],
            "repeat": 1,
        }
        for surface, options in OPTIONS.items()
    }


def validate_appearance(session, room_id, appearance):
    from .models import MediaAsset

    if not isinstance(appearance, dict) or set(appearance) != set(OPTIONS):
        raise ValueError("Choose a style for the floor, walls and background.")
    clean = {}
    for surface, options in OPTIONS.items():
        config = appearance[surface]
        if not isinstance(config, dict) or set(config) != {
            "preset",
            "color",
            "image",
            "fit",
            "crop",
            "repeat",
        }:
            raise ValueError("Invalid room surface configuration.")
        if not isinstance(config["preset"], str) or config["preset"] not in options["presets"]:
            raise ValueError("Unknown room style preset.")
        if not isinstance(config["color"], str) or not re.fullmatch(
            r"#[0-9a-fA-F]{6}", config["color"]
        ):
            raise ValueError("Choose a valid surface color.")
        fits = ("cover", "contain") if surface == "background" else ("cover", "contain", "tile")
        if (
            config["fit"] not in fits
            or not isinstance(config["crop"], list)
            or len(config["crop"]) != 2
            or not all(finite_number(n) and 0 <= n <= 1 for n in config["crop"])
        ):
            raise ValueError("Invalid image fit or crop.")
        if type(config["repeat"]) is not int or not 1 <= config["repeat"] <= 8:
            raise ValueError("Image repetition must be between 1 and 8.")
        url = config["image"]
        if url is not None:
            if not isinstance(url, str) or not re.fullmatch(r"/api/media/[a-f0-9]{32}", url):
                raise ValueError("Upload an image to this room first.")
            asset = session.get(MediaAsset, url.rsplit("/", 1)[1])
            if asset is None or asset.room_id != room_id or not asset.mime.startswith("image/"):
                raise ValueError("The image does not exist or belongs to another room.")
        clean[surface] = dict(config)
    return clean
