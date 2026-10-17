#!/data/data/com.termux/files/usr/bin/bash
# Builds the Android app: the web app (index.html, styles.css, src/, icons/) is
# packaged as assets and shown in a WebView. No Gradle: aapt2 → javac → d8 → zipalign → apksigner.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERE="$ROOT/android"
OUT="$HERE/build"
ANDROID_JAR="${ANDROID_JAR:-$HOME/android-sdk/platforms/android-34/android.jar}"
KEYSTORE="${KEYSTORE:-$HOME/.android/pyramid.keystore}"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json")"
CODE="$(echo "$VERSION" | awk -F. '{print $1 * 10000 + $2 * 100 + $3}')"

rm -rf "$OUT"
mkdir -p "$OUT/assets/www" "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "[1/6] Packing web app $VERSION"
cp -r "$ROOT/index.html" "$ROOT/styles.css" "$ROOT/manifest.webmanifest" "$ROOT/src" "$ROOT/icons" "$OUT/assets/www/"

echo "[2/6] Resources"
aapt2 compile --dir "$HERE/res" -o "$OUT/res.zip"
aapt2 link -I "$ANDROID_JAR" --manifest "$HERE/AndroidManifest.xml" \
    --min-sdk-version 26 --target-sdk-version 34 \
    --version-code "$CODE" --version-name "$VERSION" \
    -A "$OUT/assets" --java "$OUT/gen" -o "$OUT/unsigned.apk" "$OUT/res.zip"

echo "[3/6] Java"
javac -encoding UTF-8 -source 11 -target 11 -Xlint:-options -classpath "$ANDROID_JAR" \
    -d "$OUT/classes" $(find "$HERE/src" "$OUT/gen" -name '*.java')

echo "[4/6] Dex"
d8 --lib "$ANDROID_JAR" --min-api 26 --release --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
(cd "$OUT/dex" && aapt add ../unsigned.apk classes.dex >/dev/null)

echo "[5/6] Align"
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "[6/6] Sign"
if [ ! -f "$KEYSTORE" ]; then
    mkdir -p "$(dirname "$KEYSTORE")"
    keytool -genkeypair -keystore "$KEYSTORE" -alias pyramid -keyalg RSA -keysize 2048 -validity 10000 \
        -storepass android -keypass android -dname "CN=Pyramid" >/dev/null 2>&1
fi
apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
    --out "$OUT/pyramid.apk" "$OUT/aligned.apk" 2>/dev/null
apksigner verify "$OUT/pyramid.apk" 2>/dev/null
echo "Built $OUT/pyramid.apk"
