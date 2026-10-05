import time

from sqlalchemy import Column, Double, ForeignKey, Integer, Text, JSON, Boolean, Index
from sqlalchemy.orm import relationship

from .database import Base


def radio_status(radio, now=None):
    """Playback can finish while a room is empty; a snapshot must not resume an ended track."""
    now = time.time() if now is None else now
    duration = radio.get("duration")
    elapsed = radio.get("position", 0) + max(0, now - radio.get("updatedAt", now))
    if radio.get("playing") and duration and elapsed >= duration:
        return {**radio, "playing": False, "position": duration}
    return radio


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True)
    space_id = Column(
        Integer, ForeignKey("spaces.id"), nullable=False, default=1, server_default="1", index=True
    )
    is_central = Column(Boolean, nullable=False, default=False, server_default="false")
    name = Column(Text, nullable=False)
    is_open = Column(Boolean, nullable=False, default=True, server_default="true")
    appearance = Column(JSON, nullable=False, default=dict, server_default="{}")
    appearance_revision = Column(Integer, nullable=False, default=0, server_default="0")
    furniture = relationship(
        "PlacedFurniture", back_populates="room", order_by="PlacedFurniture.id"
    )

    def to_dict(self):
        from .appearance import default_appearance
        from .living_room import layout_version

        # JSON contains plain records, never SQLAlchemy objects or Three.js meshes.
        return {
            "id": self.id,
            "spaceId": self.space_id,
            "isCentral": self.is_central,
            "name": self.name,
            "isOpen": self.is_open,
            "appearance": self.appearance or default_appearance(),
            "appearanceRevision": self.appearance_revision,
            "items": [piece.to_dict() for piece in self.furniture],
            **(
                {"layoutVersion": layout_version([piece.to_dict() for piece in self.furniture])}
                if self.is_central
                else {}
            ),
        }


class PlacedFurniture(Base):
    __tablename__ = "placed_furniture"

    # Starter IDs are words; new frontend IDs are UUID strings. Text supports both.
    id = Column(Text, primary_key=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    type = Column(Text, nullable=False)
    position_x = Column(Double, nullable=False)
    position_y = Column(Double, nullable=False)
    position_z = Column(Double, nullable=False)
    rotation = Column(Double, nullable=False)
    scale = Column(Double, nullable=False, default=1, server_default="1")
    config = Column(JSON, nullable=False, default=dict, server_default="{}")
    state = Column(JSON, nullable=False, default=dict, server_default="{}")
    revision = Column(Integer, nullable=False, default=0, server_default="0")
    room = relationship("Room", back_populates="furniture")

    def to_dict(self):
        state = self.state
        if state.get("radio"):
            state = {**state, "radio": radio_status(state["radio"])}
        return {
            "id": self.id,
            "type": self.type,
            "position": [self.position_x, self.position_y, self.position_z],
            "rotation": self.rotation,
            **({"scale": self.scale} if self.scale != 1 else {}),
            **({"config": self.config, "revision": self.revision} if self.config else {}),
            **({"state": state, "revision": self.revision} if state else {}),
        }

    @classmethod
    def from_record(cls, room_id, item):
        return cls(
            id=item["id"],
            room_id=room_id,
            type=item["type"],
            position_x=item["position"][0],
            position_y=item["position"][1],
            position_z=item["position"][2],
            rotation=item["rotation"],
            scale=item.get("scale", 1),
            config=item.get("config", {}),
            state=item.get("state", {}),
            revision=item.get("revision", 0),
        )


class Visitor(Base):
    __tablename__ = "visitors"

    # Keep the original table/key so accounts retain their bedrooms and uploaded media.
    id = Column(Text, primary_key=True)
    # This legacy pointer preserves gci bedrooms; membership owns bedrooms in new spaces.
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True, unique=True)
    room = relationship("Room")
    password_hash = Column(Text, nullable=True)
    is_host = Column(Boolean, nullable=False, default=False, server_default="false")
    activation_hash = Column(Text, nullable=True)
    activation_expires_at = Column(Double, nullable=True)
    display_name = Column(Text, nullable=True)


class Space(Base):
    __tablename__ = "spaces"
    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    owner_id = Column(
        Text, ForeignKey("visitors.id", use_alter=True, name="fk_spaces_owner"), nullable=True
    )
    invitation_hash = Column(Text, nullable=True)
    invitation_expires_at = Column(Double, nullable=True)


class SpaceMembership(Base):
    __tablename__ = "space_memberships"
    # One bedroom and role for each account in each space.
    space_id = Column(Integer, ForeignKey("spaces.id"), primary_key=True)
    user_id = Column(Text, ForeignKey("visitors.id"), primary_key=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, unique=True)
    is_host = Column(Boolean, nullable=False, default=False, server_default="false")
    room = relationship("Room")


Index("one_living_room_per_space", Room.space_id, unique=True, postgresql_where=Room.is_central)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    # A leaked database must not contain usable browser session tokens.
    token_hash = Column(Text, primary_key=True)
    user_id = Column(Text, ForeignKey("visitors.id"), nullable=True, index=True)
    csrf_token = Column(Text, nullable=False)
    expires_at = Column(Double, nullable=False, index=True)


class MediaAsset(Base):
    __tablename__ = "media_assets"
    id = Column(Text, primary_key=True)
    room_id = Column(Integer, nullable=False, index=True)
    uploader = Column(Text, nullable=False)
    filename = Column(Text, nullable=False)
    mime = Column(Text, nullable=False)
    size = Column(Integer, nullable=False)
