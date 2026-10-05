"""Small rules specific to decorating the shared living room."""

import hashlib
import json

from .validation import bounds


def layout_version(items):
    # Hash only layout data: a visitor's message or radio toggle is not a furniture edit.
    # PostgreSQL returns floats even when the browser sent integers; normalize both.
    records = [
        {
            "id": item["id"],
            "type": item["type"],
            "position": [float(value) for value in item["position"]],
            "rotation": float(item["rotation"]),
            "scale": float(item.get("scale", 1)),
        }
        for item in items
    ]
    records.sort(key=lambda item: item["id"])
    return hashlib.sha256(json.dumps(records, sort_keys=True).encode()).hexdigest()


def validate_entrances(items):
    # These small clear zones join the 10×10 living room to the two hallways.
    for item in items:
        min_x, max_x, min_z, max_z = bounds(item)
        if min_z < 1.15 and max_z > -1.15 and (min_x < -4.5 or max_x > 4.5):
            raise ValueError("Keep both hallway entrances clear of furniture.")


def projector_table(items):
    table = next(
        (item for item in sorted(items, key=lambda item: item["id"]) if item["type"] == "table"),
        None,
    )
    return (
        (
            {key: table[key] for key in ("id", "type", "position", "rotation")}
            | {"scale": table.get("scale", 1)}
        )
        if table
        else None
    )
