// /api/auth  — used by the front-end to verify the owner key on unlock.
// Returns 200 {ok:true} if the key matches, 401 otherwise.

export async function onRequestGet({ env, request }) {
  const ok = !!env.WIRE_KEY && request.headers.get("x-wire-key") === env.WIRE_KEY;
  return Response.json({ ok }, { status: ok ? 200 : 401 });
}
