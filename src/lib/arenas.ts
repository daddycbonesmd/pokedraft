// Battle arena backdrops, served from /public/arenas. A battle picks one
// deterministically from its id, so every client (both players + spectators) sees
// the same arena. To add more, drop a JPG/PNG in /public/arenas and list it here.
export const ARENAS = [
  "bg-beach.jpg", "bg-city.jpg", "bg-dampcave.jpg", "bg-darkbeach.jpg", "bg-darkmeadow.jpg",
  "bg-deepsea.jpg", "bg-desert.jpg", "bg-earthycave.jpg", "bg-forest.jpg", "bg-icecave.jpg", "bg-meadow.jpg",
];

export function arenaFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `/arenas/${ARENAS[h % ARENAS.length]}`;
}
