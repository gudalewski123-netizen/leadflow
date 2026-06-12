"""Extract the user's Instagram session cookies from Chrome → .ig_cookies.json.
Run whenever the handle resolver reports auth failure (cookies expired)."""
import browser_cookie3 as bc, json, os, sys

cj = bc.chrome(domain_name="instagram.com")
ck = {c.name: c.value for c in cj}
need = ("sessionid", "csrftoken", "ds_user_id")
if not all(ck.get(k) for k in need):
    print("Missing IG cookies — log into instagram.com in Chrome first.", file=sys.stderr)
    sys.exit(1)

out = os.path.join(os.path.dirname(__file__), "..", ".ig_cookies.json")
with open(out, "w") as f:
    json.dump({k: ck[k] for k in need}, f)
print("Wrote", os.path.abspath(out))
