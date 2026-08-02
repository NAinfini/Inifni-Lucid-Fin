# FFmpeg runtime payloads

This directory is populated by `node scripts/fetch-ffmpeg.ts`. Native binaries are not stored in
Git. The installer accepts only exact release URLs and the archive/file SHA-256 values pinned in
`packages/media-engine/ffmpeg-checksums.json`.

The one-time **Publish immutable FFmpeg 8.1.2 macOS payloads** workflow builds Intel and Apple
Silicon payloads on native GitHub runners, verifies the LGPL configuration and required codecs,
publishes both archives as a content-addressed immutable GitHub Release, and opens a PR containing
the real archive and per-file hashes. Before dispatching it:

1. Enable **Settings > General > Releases > Enable release immutability**. GitHub only seals future
   releases.
2. Dispatch the workflow. Keep `create_manifest_pr` disabled unless the repository intentionally
   allows Actions to create and approve pull requests; the safer default is to download the
   generated Manifest artifact and open the pinning PR from a maintainer session.
3. Merge the resulting Manifest PR after CI passes. The workflow verifies the
   published release reports `immutable: true`; otherwise it rolls back only that newly created
   mutable release and tag, then fails without opening a Manifest PR.

Until that PR is merged, the macOS manifest entries remain `source-build`; tagged application
releases build macOS FFmpeg natively. After merge, release builds restore and verify the immutable
archives instead.
