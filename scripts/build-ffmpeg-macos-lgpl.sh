#!/usr/bin/env bash
set -Eeuo pipefail

LF_FFMPEG_VERSION='8.1.2'
LF_FFMPEG_SHA256='464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c'
LF_FREETYPE_VERSION='2.14.3'
LF_FREETYPE_SHA256='36bc4f1cc413335368ee656c42afca65c5a3987e8768cc28cf11ba775e785a5f'
LF_FRIBIDI_VERSION='1.0.16'
LF_FRIBIDI_SHA256='1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c'
LF_HARFBUZZ_VERSION='14.3.0'
LF_HARFBUZZ_SHA256='16070d77cfc4ba1f1e7327e83bf9b3f55898081cabdb94e56a33e04fc8874eae'
LF_LIBASS_VERSION='0.17.5'
LF_LIBASS_SHA256='2dca25c0e0c837ddf00b52011b3f82cac1e4ddd3ad018227806b0c2288864acc'
LF_MESON_VERSION='1.11.2'
LF_MESON_SHA256='7e4f6e83fec83e3eaac928e058b073c7557b282c35b6a2024cea143a39926a39'

LF_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LF_REPO_ROOT="$(cd "$LF_SCRIPT_DIR/.." && pwd)"
LF_OUTPUT=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || { echo '--output requires a path' >&2; exit 2; }
      LF_OUTPUT="$2"
      shift 2
      ;;
    --help)
      echo 'Usage: bash scripts/build-ffmpeg-macos-lgpl.sh --output <directory>'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

[[ "$(uname -s)" == 'Darwin' ]] || { echo 'This build must run natively on macOS.' >&2; exit 1; }
[[ -n "$LF_OUTPUT" ]] || { echo '--output is required' >&2; exit 2; }

if [[ "$LF_OUTPUT" != /* ]]; then
  LF_OUTPUT="$LF_REPO_ROOT/$LF_OUTPUT"
fi
if [[ -e "$LF_OUTPUT" ]]; then
  echo "Refusing to overwrite existing output: $LF_OUTPUT" >&2
  exit 1
fi

LF_MACHINE="$(uname -m)"
case "$LF_MACHINE" in
  x86_64) LF_PLATFORM_KEY='darwin-x64' ;;
  arm64) LF_PLATFORM_KEY='darwin-arm64' ;;
  *) echo "Unsupported macOS architecture: $LF_MACHINE" >&2; exit 1 ;;
esac

LF_TEMP_ROOT="${TMPDIR:-/tmp}"
LF_WORK="$(mktemp -d "$LF_TEMP_ROOT/lucid-fin-ffmpeg.XXXXXX")"
LF_DOWNLOADS="$LF_WORK/downloads"
LF_SOURCES="$LF_WORK/sources"
LF_BUILDS="$LF_WORK/builds"
LF_PREFIX="$LF_WORK/prefix"
LF_MESON_SITE="$LF_WORK/meson-site"
LF_STAGING="$LF_WORK/payload"

lf_cleanup() {
  case "$LF_WORK" in
    "$LF_TEMP_ROOT"/lucid-fin-ffmpeg.*) rm -rf -- "$LF_WORK" ;;
    *) echo "Refusing unsafe temporary cleanup: $LF_WORK" >&2 ;;
  esac
}
trap lf_cleanup EXIT

mkdir -p "$LF_DOWNLOADS" "$LF_SOURCES" "$LF_BUILDS" "$LF_PREFIX" "$LF_MESON_SITE"

lf_download() {
  local lf_url="$1"
  local lf_sha256="$2"
  local lf_filename="$3"
  local lf_path="$LF_DOWNLOADS/$lf_filename"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$lf_path" "$lf_url"
  printf '%s  %s\n' "$lf_sha256" "$lf_path" | shasum -a 256 --check
}

lf_extract() {
  local lf_archive="$1"
  tar -xf "$LF_DOWNLOADS/$lf_archive" -C "$LF_SOURCES"
}

lf_meson() {
  PYTHONPATH="$LF_MESON_SITE" python3 -m mesonbuild.mesonmain "$@"
}

lf_meson_build() {
  local lf_name="$1"
  local lf_source="$2"
  shift 2
  local lf_build="$LF_BUILDS/$lf_name"
  lf_meson setup "$lf_build" "$lf_source" \
    --prefix "$LF_PREFIX" \
    --libdir lib \
    --buildtype release \
    --default-library shared \
    -Db_ndebug=true \
    "$@"
  lf_meson compile -C "$lf_build"
  lf_meson install -C "$lf_build"
}

lf_download \
  "https://files.pythonhosted.org/packages/1d/c5/680527bdddf039807f22041882678b7f21d3380b4cdbc46abf2f24e2db6c/meson-$LF_MESON_VERSION-py3-none-any.whl" \
  "$LF_MESON_SHA256" \
  "meson-$LF_MESON_VERSION-py3-none-any.whl"
python3 -m pip install \
  --disable-pip-version-check \
  --no-deps \
  --no-index \
  --target "$LF_MESON_SITE" \
  "$LF_DOWNLOADS/meson-$LF_MESON_VERSION-py3-none-any.whl"

lf_download \
  "https://download.savannah.gnu.org/releases/freetype/freetype-$LF_FREETYPE_VERSION.tar.xz" \
  "$LF_FREETYPE_SHA256" \
  "freetype-$LF_FREETYPE_VERSION.tar.xz"
lf_download \
  "https://github.com/fribidi/fribidi/releases/download/v$LF_FRIBIDI_VERSION/fribidi-$LF_FRIBIDI_VERSION.tar.xz" \
  "$LF_FRIBIDI_SHA256" \
  "fribidi-$LF_FRIBIDI_VERSION.tar.xz"
lf_download \
  "https://github.com/harfbuzz/harfbuzz/releases/download/$LF_HARFBUZZ_VERSION/harfbuzz-$LF_HARFBUZZ_VERSION.tar.xz" \
  "$LF_HARFBUZZ_SHA256" \
  "harfbuzz-$LF_HARFBUZZ_VERSION.tar.xz"
lf_download \
  "https://github.com/libass/libass/releases/download/$LF_LIBASS_VERSION/libass-$LF_LIBASS_VERSION.tar.xz" \
  "$LF_LIBASS_SHA256" \
  "libass-$LF_LIBASS_VERSION.tar.xz"
lf_download \
  "https://ffmpeg.org/releases/ffmpeg-$LF_FFMPEG_VERSION.tar.xz" \
  "$LF_FFMPEG_SHA256" \
  "ffmpeg-$LF_FFMPEG_VERSION.tar.xz"

lf_extract "freetype-$LF_FREETYPE_VERSION.tar.xz"
lf_extract "fribidi-$LF_FRIBIDI_VERSION.tar.xz"
lf_extract "harfbuzz-$LF_HARFBUZZ_VERSION.tar.xz"
lf_extract "libass-$LF_LIBASS_VERSION.tar.xz"
lf_extract "ffmpeg-$LF_FFMPEG_VERSION.tar.xz"

export MACOSX_DEPLOYMENT_TARGET='13.0'
export PKG_CONFIG_PATH="$LF_PREFIX/lib/pkgconfig"
export DYLD_LIBRARY_PATH="$LF_PREFIX/lib"
export CPPFLAGS="-I$LF_PREFIX/include"
export CFLAGS="-O2 -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-L$LF_PREFIX/lib -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"

lf_meson_build \
  freetype \
  "$LF_SOURCES/freetype-$LF_FREETYPE_VERSION" \
  -Dbrotli=disabled \
  -Dbzip2=disabled \
  -Dharfbuzz=disabled \
  -Dpng=disabled \
  -Dtests=disabled \
  -Dzlib=system

lf_meson_build \
  fribidi \
  "$LF_SOURCES/fribidi-$LF_FRIBIDI_VERSION" \
  -Dbin=false \
  -Ddeprecated=true \
  -Ddocs=false \
  -Dtests=false

lf_meson_build \
  harfbuzz \
  "$LF_SOURCES/harfbuzz-$LF_HARFBUZZ_VERSION" \
  -Dbenchmark=disabled \
  -Dcairo=disabled \
  -Dchafa=disabled \
  -Dcoretext=disabled \
  -Ddocs=disabled \
  -Dfreetype=enabled \
  -Dglib=disabled \
  -Dgobject=disabled \
  -Dgpu=disabled \
  -Dgpu_demo=disabled \
  -Dicu=disabled \
  -Dintrospection=disabled \
  -Dpng=disabled \
  -Draster=disabled \
  -Dsubset=disabled \
  -Dtests=disabled \
  -Dutilities=disabled \
  -Dvector=disabled \
  -Dzlib=disabled

lf_meson_build \
  libass \
  "$LF_SOURCES/libass-$LF_LIBASS_VERSION" \
  -Dasm=disabled \
  -Dcheckasm=disabled \
  -Dcompare=disabled \
  -Dcoretext=enabled \
  -Ddirectwrite=disabled \
  -Dfontconfig=disabled \
  -Dfuzz=disabled \
  -Dlibunibreak=disabled \
  -Dprofile=disabled \
  -Drequire-system-font-provider=true \
  -Dtest=disabled

LF_FFMPEG_SOURCE="$LF_SOURCES/ffmpeg-$LF_FFMPEG_VERSION"
LF_FFMPEG_BUILD="$LF_BUILDS/ffmpeg"
mkdir -p "$LF_FFMPEG_BUILD"
(
  cd "$LF_FFMPEG_BUILD"
  "$LF_FFMPEG_SOURCE/configure" \
    --prefix="$LF_PREFIX" \
    --cc=clang \
    --cxx=clang++ \
    --disable-autodetect \
    --disable-debug \
    --disable-doc \
    --disable-ffplay \
    --disable-gpl \
    --disable-nonfree \
    --disable-static \
    --disable-x86asm \
    --enable-audiotoolbox \
    --enable-avfoundation \
    --enable-iconv \
    --enable-libass \
    --enable-libfreetype \
    --enable-libfribidi \
    --enable-libharfbuzz \
    --enable-pic \
    --enable-securetransport \
    --enable-shared \
    --enable-version3 \
    --enable-videotoolbox \
    --enable-zlib \
    --extra-cflags="-I$LF_PREFIX/include -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" \
    --extra-ldflags="-L$LF_PREFIX/lib -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" \
    --extra-libs=-liconv
  make -j"$(sysctl -n hw.logicalcpu)"
  make install
)

mkdir -p "$LF_STAGING/bin" "$LF_STAGING/lib" "$LF_STAGING/licenses" "$LF_STAGING/provenance"
cp "$LF_PREFIX/bin/ffmpeg" "$LF_PREFIX/bin/ffprobe" "$LF_STAGING/bin/"

LF_CHANGED=1
while [[ "$LF_CHANGED" -eq 1 ]]; do
  LF_CHANGED=0
  while IFS= read -r lf_binary; do
    while IFS= read -r lf_dependency; do
      case "$lf_dependency" in
        "$LF_PREFIX"/lib/*.dylib|@rpath/*.dylib|@loader_path/*.dylib|@executable_path/*/lib/*.dylib)
          lf_name="$(basename "$lf_dependency")"
          if [[ ! -e "$LF_STAGING/lib/$lf_name" ]]; then
            if [[ ! -e "$LF_PREFIX/lib/$lf_name" ]]; then
              echo "Missing build dependency for $lf_binary: $lf_dependency" >&2
              exit 1
            fi
            cp -L "$LF_PREFIX/lib/$lf_name" "$LF_STAGING/lib/$lf_name"
            LF_CHANGED=1
          fi
          ;;
      esac
    done < <(otool -L "$lf_binary" | tail -n +2 | awk '{print $1}')
  done < <(find "$LF_STAGING/bin" "$LF_STAGING/lib" -type f | LC_ALL=C sort)
done

while IFS= read -r lf_binary; do
  while IFS= read -r lf_dependency; do
    case "$lf_dependency" in
      "$LF_PREFIX"/lib/*.dylib|@rpath/*.dylib)
        lf_name="$(basename "$lf_dependency")"
        if [[ "$lf_binary" == "$LF_STAGING/bin/"* ]]; then
          lf_replacement="@executable_path/../lib/$lf_name"
        else
          lf_replacement="@loader_path/$lf_name"
        fi
        install_name_tool -change "$lf_dependency" "$lf_replacement" "$lf_binary"
        ;;
    esac
  done < <(otool -L "$lf_binary" | tail -n +2 | awk '{print $1}')
  if [[ "$lf_binary" == "$LF_STAGING/lib/"*.dylib ]]; then
    install_name_tool -id "@rpath/$(basename "$lf_binary")" "$lf_binary"
  fi
done < <(find "$LF_STAGING/bin" "$LF_STAGING/lib" -type f | LC_ALL=C sort)

while IFS= read -r lf_binary; do
  while IFS= read -r lf_dependency; do
    case "$lf_dependency" in
      /usr/lib/*|/System/Library/*) ;;
      @loader_path/*|@executable_path/*|@rpath/*)
        lf_name="$(basename "$lf_dependency")"
        if [[ ! -e "$LF_STAGING/lib/$lf_name" ]]; then
          echo "Missing bundled dependency in $lf_binary: $lf_dependency" >&2
          exit 1
        fi
        ;;
      *) echo "Unbundled macOS dependency in $lf_binary: $lf_dependency" >&2; exit 1 ;;
    esac
  done < <(otool -L "$lf_binary" | tail -n +2 | awk '{print $1}')
  lipo -archs "$lf_binary" | grep -qw "$LF_MACHINE" || {
    echo "Wrong architecture for $lf_binary; expected $LF_MACHINE" >&2
    exit 1
  }
done < <(find "$LF_STAGING/bin" "$LF_STAGING/lib" -type f | LC_ALL=C sort)

cp "$LF_FFMPEG_SOURCE/COPYING.LGPLv3" "$LF_STAGING/licenses/ffmpeg-LGPLv3.txt"
cp "$LF_SOURCES/freetype-$LF_FREETYPE_VERSION/LICENSE.TXT" "$LF_STAGING/licenses/freetype.txt"
cp "$LF_SOURCES/fribidi-$LF_FRIBIDI_VERSION/COPYING" "$LF_STAGING/licenses/fribidi.txt"
cp "$LF_SOURCES/harfbuzz-$LF_HARFBUZZ_VERSION/COPYING" "$LF_STAGING/licenses/harfbuzz.txt"
cp "$LF_SOURCES/libass-$LF_LIBASS_VERSION/COPYING" "$LF_STAGING/licenses/libass.txt"
cp "$0" "$LF_STAGING/provenance/build-ffmpeg-macos-lgpl.sh"

{
  echo "platform=$LF_PLATFORM_KEY"
  echo "macos_deployment_target=$MACOSX_DEPLOYMENT_TARGET"
  echo "ffmpeg=$LF_FFMPEG_VERSION $LF_FFMPEG_SHA256"
  echo "freetype=$LF_FREETYPE_VERSION $LF_FREETYPE_SHA256"
  echo "fribidi=$LF_FRIBIDI_VERSION $LF_FRIBIDI_SHA256"
  echo "harfbuzz=$LF_HARFBUZZ_VERSION $LF_HARFBUZZ_SHA256"
  echo "libass=$LF_LIBASS_VERSION $LF_LIBASS_SHA256"
  echo "meson=$LF_MESON_VERSION $LF_MESON_SHA256"
  clang --version | head -n 1
  lf_meson --version
  ninja --version
} > "$LF_STAGING/provenance/BUILD-PROVENANCE.txt"

{
  echo "FFmpeg source: https://ffmpeg.org/releases/ffmpeg-$LF_FFMPEG_VERSION.tar.xz"
  echo "FreeType source: https://download.savannah.gnu.org/releases/freetype/freetype-$LF_FREETYPE_VERSION.tar.xz"
  echo "FriBidi source: https://github.com/fribidi/fribidi/releases/download/v$LF_FRIBIDI_VERSION/fribidi-$LF_FRIBIDI_VERSION.tar.xz"
  echo "HarfBuzz source: https://github.com/harfbuzz/harfbuzz/releases/download/$LF_HARFBUZZ_VERSION/harfbuzz-$LF_HARFBUZZ_VERSION.tar.xz"
  echo "libass source: https://github.com/libass/libass/releases/download/$LF_LIBASS_VERSION/libass-$LF_LIBASS_VERSION.tar.xz"
  echo 'Build instructions and exact hashes are in provenance/build-ffmpeg-macos-lgpl.sh.'
  echo 'The shared libraries in lib/ remain replaceable for LGPL relinking/debugging.'
} > "$LF_STAGING/SOURCE-CODE.md"

"$LF_STAGING/bin/ffmpeg" -buildconf > "$LF_STAGING/provenance/ffmpeg-buildconf.txt" 2>&1
if grep -Eq -- '--enable-(gpl|nonfree)' "$LF_STAGING/provenance/ffmpeg-buildconf.txt"; then
  echo 'Forbidden GPL/nonfree FFmpeg build flag detected.' >&2
  exit 1
fi

LF_ENCODERS="$LF_WORK/encoders.txt"
LF_FILTERS="$LF_WORK/filters.txt"
"$LF_STAGING/bin/ffmpeg" -hide_banner -encoders > "$LF_ENCODERS" 2>&1
"$LF_STAGING/bin/ffmpeg" -hide_banner -filters > "$LF_FILTERS" 2>&1
grep -q 'h264_videotoolbox' "$LF_ENCODERS"
grep -q 'hevc_videotoolbox' "$LF_ENCODERS"
grep -Eq '[[:space:]]ass[[:space:]]' "$LF_FILTERS"
grep -Eq '[[:space:]]subtitles[[:space:]]' "$LF_FILTERS"
grep -Eq '[[:space:]]drawtext[[:space:]]' "$LF_FILTERS"

LF_SMOKE_VIDEO="$LF_WORK/smoke.mp4"
LF_SMOKE_SUBTITLE="$LF_WORK/smoke.srt"
printf '1\n00:00:00,000 --> 00:00:00,900\nLucid Fin\n' > "$LF_SMOKE_SUBTITLE"
"$LF_STAGING/bin/ffmpeg" \
  -hide_banner -loglevel error -y \
  -f lavfi -i 'color=c=black:s=64x64:d=1' \
  -vf "subtitles=$LF_SMOKE_SUBTITLE" \
  -an -c:v h264_videotoolbox -pix_fmt yuv420p \
  "$LF_SMOKE_VIDEO"
"$LF_STAGING/bin/ffprobe" \
  -v error -select_streams v:0 -show_entries stream=codec_name \
  -of default=noprint_wrappers=1:nokey=1 "$LF_SMOKE_VIDEO" | grep -q '^h264$'

(
  cd "$LF_STAGING"
  find . -type f ! -name SHA256SUMS | LC_ALL=C sort | while IFS= read -r lf_file; do
    shasum -a 256 "$lf_file"
  done > SHA256SUMS
)

mkdir -p "$(dirname "$LF_OUTPUT")"
mv "$LF_STAGING" "$LF_OUTPUT"
trap - EXIT
lf_cleanup
echo "Built and verified FFmpeg $LF_FFMPEG_VERSION LGPL payload: $LF_OUTPUT"
