# Full HD worker scroll prototype

The main link now tries the bitmap worker renderer by default, with native-video fallback if worker initialization, decoding, or quality validation fails. Explicit renderer overrides remain available for diagnosis. This selection change does not establish a sustained 45–60 FPS result.

- `/` or `/?perf=1`: prepare frames in a module worker and display transferred ImageBitmaps on the journey canvas.
- `/?renderer=native&perf=1`: native-video comparison with the same source and scroll mapping.
- `/?renderer=worker&perf=1`: explicitly select the same worker path.
- `/?renderer=auto&perf=1`: compare the previous device-based selection.

Both paths use the same 1920×1080, 60 FPS all-IDR H.264 asset. The prototype does not downsample resolution, alter the frame-to-scroll mapping, or change the ball's aspect ratio.

## Pipeline and limits

The worker checks codec support, requests hardware acceleration where supported, and routes output by a unique request timestamp. This timestamp identifies a decode request, not the source-video position. The source frame index remains authoritative. Immediate-output decoders avoid flushing; implementations that buffer output get a bounded batch/idle drain.

The worker cache allows up to four retained or in-flight decoded frames in total. Phones and constrained devices retain two compressed-range requests, a 128-sample window (80 ahead / 40 behind), and a 16 MiB compressed-data cap. Capable desktops use three range requests, a 256-sample window (192 ahead / 40 behind), and a 24 MiB cap, so a short delivery gap is less likely to exhaust available input during fast scrolling. Both worker profiles retain the same 57-frame startup readiness requirement; the larger desktop buffer fills in the background. Four RGBA-equivalent Full HD frames occupy about 31.6 MiB; this estimate excludes browser-internal decoder and GPU allocations. Each decoded VideoFrame is drawn into a Full HD worker OffscreenCanvas and snapshotted into an ImageBitmap; the VideoFrame is immediately closed so cached images do not retain scarce hardware-decoder output surfaces. The four-frame budget still applies to queued decodes and retained images. One additional copy canvas accounts for about 7.9 MiB of RGBA-equivalent working storage, excluding browser/GPU overhead. No pixel planes are read back into JavaScript. Drawing still runs on the page's rendering schedule.

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

The desktop worker had been using the phone's 80-frame forward buffer: only a third of a second at 240 source frames/second. It now uses 192 frames of forward lookahead, a 256-sample / 24 MiB compressed cache, and three download slots while retaining four decoded frames and the 57-frame readiness gate. Batches remain 24 samples and reverse history remains 40 frames, matching the phone profile. Full HD source pixels, scroll mapping, mobile settings, and fallback checks are unchanged. The larger window is intended to absorb brief delivery pauses, not compensate indefinitely for bandwidth below the source's consumption rate. Physical-device reports are still required to establish sustained visible cadence.

A deterministic variable-delivery experiment using the actual cache and pacer compared both profiles at 140, 200, and 240 source frames/second. At 24–40 MiB/second aggregate delivery, the desktop profile improved the longest gap during a 500 ms interruption in 14 of 15 tested cases and fully bridged it in 13. One cold high-speed case increased its longest gap from 320 to 360 ms while reducing recovery from 2,053 to 920 ms. Simulated readiness improved by 30–50 ms, and all resource bounds held. When sustained delivery was only 12 MiB/second and scrolling consumed roughly 16–20 MiB/second, larger buffering could not prevent stalls and sometimes worsened catch-up. These model results isolate buffer behavior; they are not browser or physical-display FPS measurements.

Local browser trials also show variable decoder/copy performance and do not establish a sustained cadence improvement. A 48 MiB candidate was rejected after slower reverse scrolling; the selected profile limits background work and retains the original reverse history. The local test decoder reports no hardware preference, while the physical desktop capture requested hardware decoding. Repeat physical-device captures remain the acceptance evidence for visible smoothness.


## Buffer-aware source travel

The worker now measures contiguous ready compressed samples (or retained decoded images) in the direction of travel. In-flight ranges and samples beyond a hole do not count as available runway. Measurement is bounded by the configured forward window and does not allocate a new cache or enlarge the existing memory budgets.

When the runway falls below its low-water mark, source-frame travel eases toward 75% of its normal pace. Below the critical reserve it can ease further, toward 25%; an empty runway holds the last image. Recovery to normal speed is gradual and uses a higher threshold to avoid accelerating after every individual range completion. Phones start reducing speed below64 ready frames and recover at72 within their80-frame forward window; desktop thresholds remain108 and172.8, and a fully covered ending can finish without requiring frames beyond the sequence. Reversal evaluates the new direction, and visibility changes reset timing without accumulating catch-up debt.

Under buffer pressure, the worker's maximum travel is 180 source frames/second reduced by the speed scale (135 at 0.75×). Healthy coverage permits responsive catch-up up to 720 source frames/second; that extra speed is removed under pressure and restored gradually as the buffer recovers. Every request is also bounded by the 40-frame retained-history corridor, preventing the cache from evicting the ready frames still needed before that request is painted. It does not cap browser RAF frequency, change the Full HD media, or alter the exact scroll destination. A fast swipe can therefore leave a longer distance for the animation to catch up, deliberately trading immediate catch-up for steadier rolling. Native fallback retains its existing pacing. A sustained supply shortage can still exhaust the buffer; this controller cannot guarantee uninterrupted motion at every bandwidth.

Debug version 5 adds optional fields at the existing half-second cadence: `bufferAheadFrames`, `bufferAheadSeconds` (source-video seconds), `bufferRequiredFrames`, `bufferPacingScale`, `bufferPacingLimited`, and `bufferPacingSpeed` (configured source frames/second). The compact panel shows the speed scale and available/required frames. Real frame gaps and stalls remain counted, including under intentional slowdown; these fields distinguish slower source travel from lost updates.


A worker-only prefetch correction keeps the cache aligned with the movement still needed from the displayed frame. A backward finger gesture that leaves its destination ahead of a lagging ball must continue buffering forward. Otherwise a full backward cache can starve the next forward frame indefinitely; a tight-byte-budget regression now covers this case and a true reversal.

The integrated scheduling regression uses actual entrance sample sizes, shared variable delivery, a temporary 12 MiB/second interval and a 500 ms interruption. Across two range-latency phases, the desktop model's longest forward hold falls from 200 ms to 40–60 ms, at the cost of about 1.6 seconds more catch-up. Desktop and phone scenarios reach their exact endpoints and reverse to the start within unchanged byte/decoded-frame bounds. These logical samples model scheduling, not browser rendering.

A local real-video Chromium probe at 20 Mbps and 100 ms latency exposed the sustained-supply limit: over 12 seconds at a requested 90 source frames/second, it made 243 displayed-frame changes (20.23/second), with a 133.3 ms p95 gap and 199.9 ms maximum gap. Six half-second samples had no contiguous forward coverage. Page RAF remained near 60/second. Restoring unrestricted delivery reached the exact frame 1080 in 5.52 seconds with no worker timeout or fallback. The controller responds and recovers, but this run does not demonstrate uninterrupted motion or stable 30 FPS under that bandwidth restriction. Physical-device reports remain necessary.


The final phone threshold deliberately favors steadier travel: with the same 80-frame buffer, slowing below 64 available frames instead of 48 reduces the model's longest phone hold from 500 ms without pacing to 80 ms with pacing. Completion takes 5.84 seconds instead of 3.28 seconds, and reverse travel reaches the exact start with a 20 ms maximum gap. The desktop model retains its 40–60 ms maximum hold. All memory/concurrency limits remain unchanged. Healthy large-jump catch-up is preserved and covered by the existing browser deadlines; no FPS assertion has been weakened.
