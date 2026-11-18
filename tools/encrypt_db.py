"""
Encrypt the product database for publishing.

    python tools/encrypt_db.py            -> asks for the password, writes data/products.enc

Only data/products.enc goes to GitHub. data/products.json (plain prices) stays on this computer.
The website asks for the same password to unlock the price list.

Format (all base64): PBKDF2-HMAC-SHA256 (310,000 rounds) -> AES-256-GCM, readable by the browser's WebCrypto.
"""
import base64, getpass, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "products.json")
DST = os.path.join(ROOT, "data", "products.enc")
ITER = 310_000

b64 = lambda b: base64.b64encode(b).decode()


def main():
    data = open(SRC, "rb").read()
    json.loads(data)  # sanity check
    pw = os.environ.get("KQ_PASSWORD") or getpass.getpass("Choose a password for the price list: ")
    if not os.environ.get("KQ_PASSWORD"):
        if getpass.getpass("Type it again: ") != pw:
            sys.exit("Passwords do not match - nothing written.")
    if len(pw) < 8:
        sys.exit("Please use at least 8 characters.")
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode())
    ct = AESGCM(key).encrypt(iv, data, None)
    json.dump({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "data": b64(ct)},
              open(DST, "w"))
    print(f"Encrypted {len(json.loads(data))} products -> data/products.enc ({os.path.getsize(DST) // 1024} KB)")


if __name__ == "__main__":
    main()
