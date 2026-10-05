"""A central living room with compact indoor hallways to named bedrooms."""

import math


def build_hall(rooms, central_room_id=1):
    bedroom_width, bedroom_depth, corridor_width = 6.4, 7, 3.2
    doors = []
    personal_rooms = sorted(
        (room for room in rooms if room.id != central_room_id), key=lambda room: room.id
    )
    for index, room in enumerate(personal_rooms):
        # Four rooms per bay: north/south entrances on each corridor wing.
        wing = -1 if index % 2 == 0 else 1
        side = -1 if index % 4 < 2 else 1
        bay = index // 4
        x = wing * (5 + bedroom_width / 2 + bay * bedroom_width)
        doors.append(
            {
                "roomId": room.id,
                "name": room.name,
                "wing": "West" if wing == -1 else "East",
                "bay": bay + 1,
                "position": [x, 0, side * 1.5],
                "rotation": 0 if side == -1 else math.pi,
                # Arrive inside the corridor, facing a real doorway, not at the lobby center.
                "arrival": [x, 0, side * 0.6],
            }
        )
    half_length = max([5] + [abs(door["position"][0]) + bedroom_width / 2 for door in doors])
    return {
        "halfLength": half_length,
        "bedroomWidth": bedroom_width,
        "bedroomDepth": bedroom_depth,
        "corridorWidth": corridor_width,
        "doors": doors,
        "walkAreas": [
            {"minX": -4.9, "maxX": 4.9, "minZ": -4.9, "maxZ": 4.9},
            {"minX": -half_length, "maxX": half_length, "minZ": -1.5, "maxZ": 1.5},
        ],
    }
