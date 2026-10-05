// Static artwork is reused when live player updates rerender the interface.
const drawings = {
  bed: (
    <>
      <rect x="10" y="17" width="44" height="34" rx="5" fill="#b88765" />
      <rect x="13" y="21" width="38" height="26" rx="3" fill="#9fae95" />
      <rect x="16" y="23" width="13" height="8" rx="3" fill="#f7eedf" />
      <rect x="35" y="23" width="13" height="8" rx="3" fill="#f7eedf" />
    </>
  ),
  chair: (
    <>
      <rect x="19" y="13" width="26" height="23" rx="5" fill="#bd8867" />
      <path d="M22 36v16m20-16v16" stroke="#987053" strokeWidth="5" />
      <rect x="16" y="32" width="32" height="9" rx="3" fill="#dbc29d" />
    </>
  ),
  table: (
    <>
      <path d="M17 30v20m30-20v20" stroke="#987053" strokeWidth="5" />
      <rect x="9" y="21" width="46" height="14" rx="5" fill="#c89e78" />
    </>
  ),
  sofa: (
    <>
      <rect x="12" y="19" width="40" height="22" rx="6" fill="#d9a092" />
      <rect x="10" y="32" width="44" height="15" rx="5" fill="#edbaaa" />
      <path d="M17 47v5m30-5v5" stroke="#987053" strokeWidth="4" />
      <rect x="7" y="28" width="9" height="18" rx="4" fill="#cb8d81" />
      <rect x="48" y="28" width="9" height="18" rx="4" fill="#cb8d81" />
    </>
  ),
  chaiseLongue: (
    <>
      <path d="M10 43V20q0-8 7-8t9 10q2 11 12 10l15-5v14q-18 8-43 2Z" fill="#9a405b" />
      <path d="M13 40q22 5 38-2" stroke="#c47b8e" strokeWidth="2" fill="none" />
      <path d="M16 45v7m31-8v8" stroke="#31333d" strokeWidth="4" />
    </>
  ),
  plant: (
    <>
      <path d="M32 40V20" stroke="#687353" strokeWidth="3" />
      <ellipse cx="24" cy="25" rx="9" ry="6" transform="rotate(35 24 25)" fill="#7c946f" />
      <ellipse cx="39" cy="20" rx="9" ry="6" transform="rotate(-40 39 20)" fill="#617e60" />
      <path d="M21 37h22l-4 17H25z" fill="#c48d70" />
    </>
  ),
  lamp: (
    <>
      <path d="M32 30v23" stroke="#a48055" strokeWidth="3" />
      <ellipse cx="32" cy="53" rx="12" ry="3" fill="#b88765" />
      <path d="M23 14h18l7 19H16z" fill="#e7c98e" />
    </>
  ),
  poolDoll: (
    <>
      <path
        d="M24 30 16 38m24-8 8 8M27 43l-3 12m13-12 3 12"
        stroke="#f3bda3"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <ellipse cx="32" cy="19" rx="11" ry="13" fill="#bc322c" />
      <circle cx="32" cy="21" r="8" fill="#f3bda3" />
      <rect x="24" y="28" width="16" height="20" rx="6" fill="#f3bda3" />
      <path d="m24 32 8 3 8-3v6H24zm1 9h14l-7 7z" fill="#19b5bf" />
      <circle cx="29" cy="20" r="1" fill="#302f3c" />
      <circle cx="35" cy="20" r="1" fill="#302f3c" />
    </>
  ),
};
const picture = (
  <>
    <rect x="12" y="9" width="40" height="46" rx="4" fill="#a78060" />
    <rect x="16" y="13" width="32" height="38" rx="2" fill="#e8efdb" />
    <circle cx="39" cy="23" r="5" fill="#edc579" />
    <path d="m16 43 12-15 8 10 12-8v21H16Z" fill="#86a38a" />
  </>
);
const book = (
  <>
    <path d="M9 15q13-5 23 2 10-7 23-2v35q-13-5-23 2-10-7-23-2Z" fill="#b78668" />
    <path d="M12 18q10-3 20 2 10-5 20-2v28q-10-3-20 2-10-5-20-2Z" fill="#f7efdb" />
    <path
      d="M32 20v28m-16-23 11 2m10 0 10-2m-31 7 11 2m10 0 10-2"
      stroke="#bea888"
      strokeWidth="2"
    />
  </>
);
const interactive = {
  bookTable: (
    <>
      {drawings.table}
      <path d="m24 11 18-4 3 19-18 4Z" fill="#768769" />
      <path d="m26 13 14-3m-13 6 12-3" stroke="#efe2bd" strokeWidth="2" />
    </>
  ),
  poster: picture,
  photoFrame: picture,
  crookedPicture: <g transform="rotate(-9 32 32)">{picture}</g>,
  guestBook: book,
  retroRadio: (
    <>
      <rect x="9" y="20" width="46" height="31" rx="7" fill="#b78462" />
      <path d="M19 20v-8h26v8" fill="none" stroke="#89684e" strokeWidth="4" />
      <circle cx="24" cy="36" r="10" fill="#e5ccb0" />
      <circle cx="24" cy="36" r="6" fill="#7d8472" />
      <rect x="39" y="28" width="10" height="5" rx="2" fill="#e3c99b" />
      <circle cx="44" cy="43" r="4" fill="#eee6cc" />
    </>
  ),
  aquarium: (
    <>
      <rect x="8" y="16" width="48" height="35" rx="5" fill="#779e9e" />
      <rect x="11" y="20" width="42" height="25" fill="#c2e2dc" />
      <path d="m23 29-7-4v14l7-4" fill="#d49b78" />
      <ellipse cx="29" cy="32" rx="9" ry="6" fill="#e8be79" />
      <circle cx="33" cy="30" r="1.5" fill="#485b57" />
      <path d="M44 45V32m0 6 6-5m-6 8-5-5" stroke="#719d75" strokeWidth="3" />
    </>
  ),
  discoBall: (
    <>
      <path d="M32 5v10" stroke="#9d927e" strokeWidth="3" />
      <circle cx="32" cy="33" r="20" fill="#b1a8c6" />
      <path
        d="M14 26h36M13 37h38M20 46h24M32 13v40M24 15q-10 18 0 35m16-35q10 18 0 35"
        fill="none"
        stroke="#ddd4e9"
        strokeWidth="2"
      />
    </>
  ),
  visitorBoard: (
    <>
      <rect x="7" y="12" width="50" height="40" rx="4" fill="#b78665" />
      <rect x="12" y="17" width="40" height="30" rx="2" fill="#7eaaa2" />
      <path
        d="m18 27 7-5 5 8 12-6m-22 15h24"
        stroke="#f3efdb"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </>
  ),
  giantDuck: (
    <>
      <ellipse cx="29" cy="42" rx="22" ry="13" fill="#eac578" />
      <circle cx="39" cy="25" r="13" fill="#eac578" />
      <path d="m49 25 11 5-11 4" fill="#d99863" />
      <circle cx="43" cy="22" r="2" fill="#4f5140" />
      <path d="M14 42q8 8 20 0" fill="none" stroke="#d7af60" strokeWidth="3" />
    </>
  ),
  eyePlant: (
    <>
      {drawings.plant}
      <circle cx="29" cy="22" r="4" fill="#f6efdc" />
      <circle cx="38" cy="20" r="4" fill="#f6efdc" />
      <circle cx="30" cy="22" r="1.5" fill="#465444" />
      <circle cx="38" cy="20" r="1.5" fill="#465444" />
    </>
  ),
  handChair: drawings.chair,
  plasticThrone: (
    <>
      {drawings.chair}
      <path d="m20 10-2-7 8 3 6-5 6 5 8-3-2 7Z" fill="#d7b96f" />
    </>
  ),
  coneLamp: (
    <>
      <ellipse cx="32" cy="52" rx="23" ry="5" fill="#857f68" />
      <path d="m26 10 12 0 12 41H14Z" fill="#daaa75" />
      <path d="m22 25 20 0 3 10H19Z" fill="#f2eada" />
      <path d="M32 5V2m-14 8-3-3m34 3 3-3" stroke="#d7bd76" strokeWidth="3" />
    </>
  ),
  magicMirror: (
    <>
      <path d="M26 47v8m12-8v8" stroke="#a17b5b" strokeWidth="4" />
      <rect x="13" y="5" width="38" height="45" rx="19" fill="#b99673" />
      <rect x="18" y="10" width="28" height="35" rx="14" fill="#ccdeda" />
      <path d="m22 28 13-13m-8 22 12-12" stroke="#f0f6ea" strokeWidth="3" />
    </>
  ),
  sceneWindow: picture,
  monsterRug: (
    <>
      <ellipse cx="32" cy="39" rx="26" ry="15" fill="#a99bc1" />
      <circle cx="24" cy="30" r="7" fill="#f5f0df" />
      <circle cx="40" cy="30" r="7" fill="#f5f0df" />
      <circle cx="26" cy="31" r="3" fill="#596457" />
      <circle cx="38" cy="31" r="3" fill="#596457" />
      <path d="M23 43q9 7 18 0" fill="none" stroke="#796990" strokeWidth="3" />
    </>
  ),
  tinyDoor: (
    <>
      <rect x="16" y="10" width="32" height="44" rx="14" fill="#cfae84" />
      <rect x="21" y="15" width="22" height="39" rx="10" fill="#9a7759" />
      <circle cx="37" cy="37" r="2" fill="#e9ce82" />
    </>
  ),
  friendPortal: (
    <>
      <path d="M12 53V30a20 20 0 0 1 40 0v23Z" fill="#a99cc5" />
      <path d="M18 50V30a14 14 0 0 1 28 0v20Z" fill="#d1dbe8" />
      <path d="m30 27 9 8-9 8m-7-8h16" stroke="#819785" strokeWidth="3" fill="none" />
    </>
  ),
  mysteryBox: (
    <>
      <path d="m9 25 23-8 23 8v25l-23 8-23-8Z" fill="#b88c66" />
      <path d="m9 25 23 9 23-9M32 34v24" fill="none" stroke="#dcc4a1" strokeWidth="3" />
      <text x="32" y="30" textAnchor="middle" fontSize="16" fill="#faf1d7">
        ?
      </text>
    </>
  ),
  noTouchButton: (
    <>
      <ellipse cx="32" cy="45" rx="25" ry="10" fill="#bfaa88" />
      <rect x="13" y="25" width="38" height="19" rx="9" fill="#c37f70" />
      <ellipse cx="32" cy="26" rx="19" ry="8" fill="#df9c8c" />
      <path d="M32 17V9m-18 9-5-5m41 5 5-5" stroke="#d4b479" strokeWidth="3" />
    </>
  ),
};

export default function FurnitureIcon({ type }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      {drawings[type] ?? interactive[type] ?? (
        <>
          <rect x="12" y="12" width="40" height="40" rx="8" fill="#adbaa3" />
          <path
            d="m23 27 9-5 9 5v12l-9 5-9-5Zm0 0 9 5 9-5M32 32v12"
            stroke="#f7f2e4"
            strokeWidth="2"
            fill="none"
          />
        </>
      )}
    </svg>
  );
}
