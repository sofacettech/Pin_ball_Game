# Full HD worker scroll prototype

The main link now tries the bitmap worker renderer by default, with native-video fallback if worker initialization, decoding, or quality validation fails. Explicit renderer overrides remain available for diagnosis. This selection change does not establish a sustained 45–60 FPS result.

- `/` or `/?perf=1`: prepare frames in a module worker and display transferred ImageBitmaps on the journey canvas.
- `/?renderer=native&perf=1`: native-video comparison with the same source and scroll mapping.
- `/?renderer=worker&perf=1`: explicitly select the same worker path.
- `/?renderer=auto&perf=1`: compare the previous device-based selection.

Both paths use the same 1920×1080, 60 FPS all-IDR H.264 asset. The prototype does not downsample resolution, alter the frame-to-scroll mapping, or change the ball's aspect ratio.

## Pipeline and limits

The worker checks codec support, requests hardware acceleration where supported, and routes output by a unique request timestamp. This timestamp identifies a decode request, not the source-video position. The source frame index remains authoritative. Immediate-output decoders avoid flushing; implementations that buffer output get a bounded batch/idle drain.

The worker cache allows up to four retained or in-flight decoded frames in total. Phones and constrained devices retain two compressed-range requests, a 128-sample window (80 ahead / 40 behind), and a 16 MiB compressed-data cap. Capable desktops use three range requests, a 512-sample window (256 ahead / 224 behind), and a 48 MiB cap, so a short delivery gap is less likely to exhaust available input during fast scrolling. Both worker profiles retain the same 57-frame startup readiness requirement; the larger desktop buffer fills in the background. Four RGBA-equivalent Full HD frames occupy about 31.6 MiB; this estimate excludes browser-internal decoder and GPU allocations. Each decoded VideoFrame is drawn into a Full HD worker OffscreenCanvas and snapshotted into an ImageBitmap; the VideoFrame is immediately closed so cached images do not retain scarce hardware-decoder output surfaces. The four-frame budget still applies to queued decodes and retained images. One additional copy canvas accounts for about 7.9 MiB of RGBA-equivalent working storage, excluding browser/GPU overhead. No pixel planes are read back into JavaScript. Drawing still runs on the page's rendering schedule.

The worker validates source dimensions and colour metadata before copying. The adapter validates the bitmap dimensions and request metadata before accepting it. Copying or transfer failure closes resources and restores native video. Canceling work on reversal retains its slot until the worker acknowledges release. Stale outputs are closed. Hiding/disposal clears pending work. Unsupported initialization, decode failure, or invalid dimensions/colour metadata restores native video. A hardware preference is a request, not proof that the browser chose hardware decoding.

## Validation

`node --test --test-concurrency=1 tests/*.test.mjs` runs the regression suite. `node scripts/browser-worker-cadence.mjs` compares both paths with the real video. Set `SOFACET_BROWSER=webkit` or `chromium`, `SOFACET_PLAYWRIGHT_PATH` for an isolated Playwright installation, and `SOFACET_WORKER_OUTPUT` to retain JSON/screenshots. Set `SOFACET_DEVICE=desktop` to exercise the desktop profile (the default is mobile); the desktop harness overrides capability hints to select that profile on low-core CI hosts, which does not emulate desktop performance. Set `SOFACET_WORKER_DEFAULT=1` to test worker selection without a renderer query.

The comparison distinguishes successful canvas draw submissions from native compositor callbacks. A canvas draw returning does not independently prove display presentation. Decoder throughput alone must never be reported as visible FPS. The report records per-direction rates, frame gaps, scroll distance, queue bounds, and functional/quality failures. An unsupported worker is a fallback result, not a passing worker performance result.

## Phone validation

On each physical phone, compare the worker and native URLs in fresh visits under the same power/network conditions. Scroll forward and backward at similar speeds, include a fast swipe and a reversal, then save Debug reports. Repeat with a warm buffer. Confirm the report actually says `worker-webcodecs`; inspect `workerFailure` and `fallbackReason` otherwise.

The existing video averages roughly 41 Mbps at normal playback speed. A worker does not eliminate cold-network buffering or system power/thermal limits. The default switch was requested explicitly after the Android buffer-stall fix. Performance validation still requires sustained improvement on both phones, accurate settled frames/colours, bounded memory, and no regression in startup or game handoff.

## Prototype results — 24 October 2026

The initial worker prototype, before bitmap detachment, reached 59.82 canvas draw submissions/second in both directions in a local Chromium run. A hosted Chromium run reached 50.00 forward and 46.73 reverse; its settled frame matched the native reference exactly. A live Render/CDN run reached only 32.73 forward and 24.00 reverse, with idle decoding while frame downloads were pending. These are browser draw-submission measurements, not physical-phone or compositor FPS guarantees.

Hosted WebKit 26.6 reports a different transfer function and range for decoded frames. The strict colour check rejects that output and restores native video. The fallback completed the journey, jumps, reversal, hide/resume, and settled-frame comparison. The worker performance check intentionally fails when fallback is used. Native WebKit cadence and swipe tests also miss their timing targets; the build, unit suite, smoke checks and full-journey checks pass. This is not a verified 45–60 FPS release for both phones.

Numerical probes rule out a one-frame reference offset. Experimental NV12 transfer/range corrections reduce the average colour difference but leave localized differences, so neither correction is included in the runtime. The main link tries the worker and falls back when its strict checks fail. Check debug renderer and workerFailure fields to establish whether the actual phones use the worker path; hosted WebKit and the reported iPhone OS are different versions.

## Android output-surface recovery

Two physical Android captures requested worker rendering but stopped after four requests, with only two or three outputs, then fell back on the eight-second timeout. A bounded decoder fixture reproduces that pattern when transferred VideoFrames retain a pool of two or three hardware surfaces. Copying to an independently owned ImageBitmap before closing each VideoFrame lets all four requests finish while the consumer retains its images. This fixes the reproduced retention mechanism; a new phone report is still required to confirm the actual device recovers and to measure sustained cadence. The game-startup long tasks in those reports are a separate issue.

## Desktop follow-up and pipeline capture

The subsequent desktop capture stayed on the bitmap worker with 1,146 successful decodes, zero timeouts, and zero fallbacks. Active samples had a median 30.6 journey updates/second, declining to a median 23.7 later, while page callbacks remained near 75/second. Average decode/copy times were approximately 3.84/0.29 ms; those averages do not establish the cause of the observed 507 ms update gap. The game bundle's longest task occurred after the journey completed and is a separate issue.

That report lacked cache/network history. Debug version 5 records a compact pipeline snapshot in each existing 500 ms sample so a cold and warm repeat can distinguish unavailable compressed data, pending decodes, and ready images waiting to be drawn. The recorder remains opt-in through `?perf=1`, collapsible, bounded to 120 samples, and never uploads automatically. The default switch itself does not fix this desktop stutter.

## Desktop compressed-data starvation

The next version-5 desktop capture completed 1,567 worker decodes with zero timeouts or fallbacks. Its approximate active-time-weighted update rate rose from 36.8 to 54.6/second and the worst gap fell from 507 to 373 ms, but median scrolling speed also fell from 196 to 138 source frames/second. These captures are not a controlled performance comparison.

At 26.161 seconds, the page still received about 75 callbacks/second while journey updates fell to 11.9/second. The cache had one compressed sample, two network requests, 81 queued entries, and no outstanding worker decode. Only 24 source frames arrived while the target advanced 126 over that half-second. When delivery resumed, lag fell from 159 to 69 to four source frames. This is evidence of unavailable compressed input, not a decoder timeout; the report does not identify the cause of the delayed network ranges. Another slow window decoded 77 frames for 14 draws, so target relevance may also contribute.

The desktop worker had been using the phone's 80-frame forward buffer: only a third of a second at 240 source frames/second. It now uses the existing desktop compressed-cache profile while retaining four decoded frames and the 57-frame readiness gate. Full HD source pixels, scroll mapping, mobile settings, and fallback checks are unchanged. The larger window is intended to absorb brief delivery pauses, not compensate indefinitely for bandwidth below the source's consumption rate. Physical-device reports are still required to establish sustained visible cadence.

A deterministic variable-delivery experiment using the actual cache and pacer compared both profiles at 140, 200, and 240 source frames/second. At 24–40 MiB/second aggregate delivery, the larger window absorbed a 500 ms interruption in every tested pair, with a simulated first-readiness cost of 0–25 ms. When sustained delivery was only 12 MiB/second and scrolling consumed roughly 16–20 MiB/second, the larger window could not prevent stalls and sometimes worsened catch-up. These model results isolate buffer behavior; they are not browser or physical-display FPS measurements.
