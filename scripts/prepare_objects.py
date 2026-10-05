"""Import the supplied GLBs and split selected triangles into animatable semantic nodes.
The original vertices/materials are retained; this is asset preparation, not runtime physics.
"""

import json, struct, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = Path("/Users/josemanuel/Downloads/social_rooms_24_objetos.zip")
KEYS = [
    "dartRack",
    "retroRadio",
    "poster",
    "photoFrame",
    "visitorBoard",
    "guestBook",
    "snackMachine",
    "aquarium",
    "discoBall",
    "handChair",
    "monsterRug",
    "magicMirror",
    "tinyDoor",
    "noTouchButton",
    "sceneWindow",
    "friendPortal",
    "memoryCabinet",
    "mysteryBox",
    "coneLamp",
    "plasticThrone",
    "giantDuck",
    "eyePlant",
    "wingToaster",
    "crookedPicture",
]
ACTIONS = [
    ["darts", "accessory"],
    ["play", "pause"],
    ["view"],
    ["view", "next"],
    ["draw"],
    ["message"],
    ["snack", "consume"],
    ["feed"],
    ["toggle"],
    ["sit"],
    ["step"],
    ["mirror", "removeEffect"],
    ["greet"],
    ["surprise"],
    ["view"],
    ["visit"],
    ["inspect"],
    ["open"],
    ["toggle"],
    ["sit"],
    ["squeak"],
    ["wave", "water"],
    ["toast"],
    ["straighten", "view"],
]
LABELS = [
    "Jugar a los dardos",
    "Escuchar radio",
    "Ver imagen",
    "Ver fotos",
    "Dejar un dibujo",
    "Dejar mensaje",
    "Elegir snack",
    "Dar comida",
    "Modo fiesta",
    "Sentarse",
    "Saludar al monstruo",
    "Mirarse",
    "Llamar a la puerta",
    "NO TOCAR",
    "Ver paisaje",
    "Visitar habitación",
    "Ver recuerdos",
    "Abrir caja",
    "Encender / apagar",
    "Sentarse en el trono",
    "¡Cuac!",
    "Saludar / regar",
    "Hacer tostada",
    "Enderezar cuadro",
]
DEFAULTS = {
    "dartRack": {"accessories": []},
    "retroRadio": {"tracks": []},
    "poster": {"images": [], "fit": "contain", "crop": [0.5, 0.5], "frameColor": "#805c42"},
    "photoFrame": {
        "images": [],
        "fit": "contain",
        "crop": [0.5, 0.5],
        "frameColor": "#805c42",
        "slideshow": False,
        "interval": 5,
    },
    "visitorBoard": {},
    "aquarium": {"fishNames": ["Sol", "Coral", "Azul"], "color": "#8fcbd1", "intensity": 0.4},
    "discoBall": {"color": "#a58acd", "intensity": 0.6},
    "handChair": {"pose": "normal"},
    "monsterRug": {"color": "#9874bf"},
    "sceneWindow": {"scene": "space", "ambient": False},
    "friendPortal": {"destination": None},
    "memoryCabinet": {"slots": []},
    "coneLamp": {"color": "#ffce8c", "intensity": 0.7},
    "plasticThrone": {"pose": "normal"},
    "giantDuck": {"color": "#e9be53"},
    "crookedPicture": {"images": [], "fit": "contain", "crop": [0.5, 0.5], "frameColor": "#805c42"},
}


def floats(g, b, a):
    ac = g["accessors"][a]
    v = g["bufferViews"][ac["bufferView"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[ac["type"]]
    f = {5126: "f", 5125: "I", 5123: "H", 5121: "B"}[ac["componentType"]]
    size = struct.calcsize("<" + f * n)
    off = v.get("byteOffset", 0) + ac.get("byteOffset", 0)
    stride = v.get("byteStride", size)
    return [struct.unpack_from("<" + f * n, b, off + i * stride) for i in range(ac["count"])]


def semantic(key, mat, c):
    x, y, z = c
    if mat.startswith("texture_") and key in [
        "poster",
        "photoFrame",
        "visitorBoard",
        "sceneWindow",
        "crookedPicture",
    ]:
        return "surface"
    if key == "aquarium":
        if mat in ["gold", "red", "blue"]:
            return "fish" + {"gold": "0", "red": "1", "blue": "2"}[mat]
        if mat == "black":
            return "fish" + ("0" if x < -0.08 else "1" if y > 0.4 else "2")
    if key in ["monsterRug", "eyePlant"] and mat == "black":
        return "eyes"
    if key == "eyePlant" and mat == "green":
        return "leaves"
    if key == "tinyDoor" and mat in ["teal", "gold"]:
        return "door"
    if key == "mysteryBox" and y > 0.46:
        return "lid"
    if key == "wingToaster":
        if mat == "white":
            return "wingLeft" if x < 0 else "wingRight"
        if mat in ["wood", "gold"]:
            return "toast"
    if key == "memoryCabinet" and mat in ["gold", "teal", "purple", "cream"]:
        return "samples"
    if key == "discoBall" and mat != "black":
        return "ball"
    return "body"


def process(raw, key):
    jl = struct.unpack_from("<I", raw, 12)[0]
    g = json.loads(raw[20 : 20 + jl])
    off = 20 + jl
    bl = struct.unpack_from("<I", raw, off)[0]
    b = bytearray(raw[off + 8 : off + 8 + bl])
    nodes = []
    meshes = []
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for mesh in g["meshes"]:
        for p in mesh["primitives"]:
            pos = floats(g, b, p["attributes"]["POSITION"])
            inds = [a[0] for a in floats(g, b, p["indices"])]
            mat = g["materials"][p["material"]]["name"]
            groups = {}
            for xyz in pos:
                for j in range(3):
                    lo[j] = min(lo[j], xyz[j])
                    hi[j] = max(hi[j], xyz[j])
            for i in range(0, len(inds), 3):
                tri = inds[i : i + 3]
                c = [sum(pos[t][j] for t in tri) / 3 for j in range(3)]
                part = semantic(key, mat, c)
                groups.setdefault(part, []).extend(tri)
            for part, ii in groups.items():
                while len(b) % 4:
                    b.append(0)
                start = len(b)
                b.extend(struct.pack("<" + "I" * len(ii), *ii))
                v = len(g["bufferViews"])
                g["bufferViews"].append(
                    {"buffer": 0, "byteOffset": start, "byteLength": len(ii) * 4, "target": 34963}
                )
                a = len(g["accessors"])
                g["accessors"].append(
                    {"bufferView": v, "componentType": 5125, "count": len(ii), "type": "SCALAR"}
                )
                np = dict(p, indices=a)
                pivots = {
                    "lid": [0, 0.46, -0.21],
                    "door": [-0.1275, 0.265, 0.044],
                    "wingLeft": [-0.2, 0.36, 0],
                    "wingRight": [0.2, 0.36, 0],
                }
                pivot = pivots.get(part)
                if pivot:
                    start = len(b)
                    shifted = [[xyz[j] - pivot[j] for j in range(3)] for xyz in pos]
                    b.extend(
                        struct.pack(
                            "<" + "f" * (len(pos) * 3), *(n for xyz in shifted for n in xyz)
                        )
                    )
                    v = len(g["bufferViews"])
                    g["bufferViews"].append(
                        {
                            "buffer": 0,
                            "byteOffset": start,
                            "byteLength": len(pos) * 12,
                            "target": 34962,
                        }
                    )
                    a = len(g["accessors"])
                    g["accessors"].append(
                        {
                            "bufferView": v,
                            "componentType": 5126,
                            "count": len(pos),
                            "type": "VEC3",
                            "min": [min(x[j] for x in shifted) for j in range(3)],
                            "max": [max(x[j] for x in shifted) for j in range(3)],
                        }
                    )
                    np["attributes"] = dict(np["attributes"], POSITION=a)
                mi = len(meshes)
                meshes.append({"name": part, "primitives": [np]})
                nodes.append(
                    {"name": part, "mesh": mi, **({"translation": pivot} if pivot else {})}
                )
    g["meshes"] = meshes
    g["nodes"] = nodes
    g["scenes"] = [{"nodes": list(range(len(nodes)))}]
    g["scene"] = 0
    g["buffers"][0]["byteLength"] = len(b)
    j = json.dumps(g, separators=(",", ":")).encode()
    j += b" " * (-len(j) % 4)
    b += b"\0" * (-len(b) % 4)
    result = (
        struct.pack("<III", 0x46546C67, 2, 28 + len(j) + len(b))
        + struct.pack("<II", len(j), 0x4E4F534A)
        + j
        + struct.pack("<II", len(b), 0x004E4942)
        + b
    )
    return result, lo, hi


if __name__ == "__main__":
    z = zipfile.ZipFile(PACK)
    catalog = json.loads(z.read("catalogo.json"))
    registry = {}
    out = ROOT / "src/assets/interactive"
    out.mkdir(exist_ok=True, parents=True)
    for i, row in enumerate(catalog):
        key = KEYS[i]
        original = z.read("modelos/" + row["archivo"])
        raw, lo, hi = process(original, key)
        (out / row["archivo"]).write_bytes(raw)
        # Models are small enough to use metres as supplied; center the X/Z footprint.
        entry = {
            "label": row["nombre"],
            "description": LABELS[i],
            "file": row["archivo"],
            "width": round(hi[0] - lo[0] + 0.08, 3),
            "depth": round(hi[2] - lo[2] + 0.08, 3),
            "height": round(hi[1], 3),
            "center": [(hi[0] + lo[0]) / 2, 0, (hi[2] + lo[2]) / 2],
            "color": "#a899ba",
            "actions": ACTIONS[i],
            "defaults": DEFAULTS.get(key, {}),
            "blocking": key != "monsterRug",
        }
        if key in ["handChair", "plasticThrone"]:
            entry["seatHeight"] = 0.39 if key == "handChair" else 0.45
        if key in ["poster", "photoFrame", "visitorBoard", "sceneWindow", "crookedPicture"]:
            dims = {
                "poster": [0.63, 0.93, 0.64],
                "photoFrame": [0.43, 0.43, 0.34],
                "visitorBoard": [0.88, 0.63, 0.6],
                "sceneWindow": [0.78, 0.98, 0.68],
                "crookedPicture": [0.59, 0.63, 0.46],
            }[key]
            entry["surface"] = {"width": dims[0], "height": dims[1], "y": dims[2], "z": 0.05}
        if key == "crookedPicture":
            entry["surface"]["tilt"] = -0.14
        jl = struct.unpack_from("<I", original, 12)[0]
        g = json.loads(original[20 : 20 + jl])
        bin_data = original[28 + jl :]
        if g.get("images"):
            view = g["bufferViews"][g["images"][0]["bufferView"]]
            name = key + "-initial.png"
            (out / name).write_bytes(
                bin_data[view.get("byteOffset", 0) : view.get("byteOffset", 0) + view["byteLength"]]
            )
            entry["initialImage"] = name
        registry[key] = entry
    (ROOT / "src/data/objects.json").write_text(
        json.dumps(registry, ensure_ascii=False, indent=2) + "\n"
    )
    print("Prepared", len(registry), "models with named animation parts.")
