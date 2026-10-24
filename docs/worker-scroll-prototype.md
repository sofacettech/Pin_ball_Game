# Full HD worker scroll prototype

The worker renderer is an opt-in experiment. The default renderer selection is unchanged.

- `/?renderer=worker&perf=1`: prepare frames in a module worker and display transferred VideoFrames on the journey canvas.
- `/?renderer=native&perf=1`: native-video comparison with the same source and scroll mapping.
- `/?perf=1`: the existing automatic selection.

Both paths use the same 1920×1080, 60 FPS all-IDR H.264 asset. The prototype does not downsample resolution, alter the frame-to-scroll mapping, or change the ball's aspect ratio.

## Pipeline and limits

The worker checks codec support, requests hardware acceleration where supported, and routes output by a unique request timestamp. This timestamp identifies a decode request, not the source-video position. The source frame index remains authoritative. Immediate-output decoders avoid flushing; implementations that buffer output get a bounded batch/idle drain.

The cache allows up to four retained or in-flight decoded frames in total, two compressed-range requests, 128 compressed samples, and 16 MiB of compressed data. Four RGBA-equivalent Full HD frames occupy about 31.6 MiB; this estimate excludes browser-internal decoder and GPU allocations. Decoded frames are transferred without reading their pixel planes on the main thread. Drawing still runs on the page's rendering schedule.

Canceling work on reversal retains its slot until the worker acknowledges release. Stale outputs are closed. Hiding/disposal clears pending work. Unsupported initialization, decode failure, or invalid dimensions/colour metadata restores native video. A hardware preference is a request, not proof that the browser chose hardware decoding.

## Validation

`node --test --test-concurrency=1 tests/*.test.mjs` runs the regression suite. `node scripts/browser-worker-cadence.mjs` compares both paths with the real video. Set `SOFACET_BROWSER=webkit` or `chromium`, `SOFACET_PLAYWRIGHT_PATH` for an isolated Playwright installation, and `SOFACET_WORKER_OUTPUT` to retain JSON/screenshots.

The comparison distinguishes successful canvas draw submissions from native compositor callbacks. A canvas draw returning does not independently prove display presentation. Decoder throughput alone must never be reported as visible FPS. The report records per-direction rates, frame gaps, scroll distance, queue bounds, and functional/quality failures. An unsupported worker is a fallback result, not a passing worker performance result.

## Phone validation

On each physical phone, compare the worker and native URLs in fresh visits under the same power/network conditions. Scroll forward and backward at similar speeds, include a fast swipe and a reversal, then save Debug reports. Repeat with a warm buffer. Confirm the report actually says `worker-webcodecs`; inspect `workerFailure` and `fallbackReason` otherwise.

The existing video averages roughly 41 Mbps at normal playback speed. A worker does not eliminate cold-network buffering or system power/thermal limits. Do not enable it by default based only on a hosted benchmark. Promotion requires sustained improvement on both phones, accurate settled frames/colours, bounded memory, and no regression in startup or game handoff.

## Prototype results — 24 October 2026

The Full HD worker prototype reached 59.82 canvas draw submissions/second in both directions in a local Chromium run. A hosted Chromium run reached 50.00 forward and 46.73 reverse; its settled frame matched the native reference exactly. These are browser draw-submission measurements, not physical-phone or compositor FPS guarantees.

Hosted WebKit 26.6 reports a different transfer function and range for decoded frames. The strict colour check rejects that output and restores native video. The fallback completed the journey, jumps, reversal, hide/resume, and settled-frame comparison. The worker performance check intentionally fails when fallback is used. Native WebKit cadence and swipe tests also miss their timing targets; the build, unit suite, smoke checks and full-journey checks pass. This is not a verified 45–60 FPS release for both phones.

Numerical probes rule out a one-frame reference offset. Experimental NV12 transfer/range corrections reduce the average colour difference but leave localized differences, so neither correction is included in the runtime. The default renderer remains unchanged. Use the opt-in link to establish whether the actual phones can use the worker path; hosted WebKit and the reported iPhone OS are different versions.
