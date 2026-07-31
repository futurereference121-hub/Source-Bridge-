"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { upload } from "@vercel/blob/client";
import {
  ALLOWED_STORY_VIDEO_TYPES,
  MAX_ACTIVE_STORY_SECONDS,
  MAX_STORY_CLIP_BYTES,
  MAX_STORY_CLIP_SECONDS,
  STORY_FORMAT_HINT,
  STORY_PRIVACY_NOTICE,
  STORY_VIDEO_ACCEPT,
  StoryUploadErrorCode,
  resolveStoryMime,
  storyErrorMessage,
  type StoryUploadErrorCode as StoryErrorCode,
} from "@/lib/story-constants";

type Step = "choose" | "preview" | "uploading";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSeconds(n: number) {
  const s = Math.round(n);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function mimeLabel(type: string) {
  if (type.includes("mp4")) return "MP4";
  if (type.includes("webm")) return "WebM";
  if (type.includes("quicktime")) return "MOV";
  return type || "Video";
}

function messageFromResponse(json: {
  error?: string;
  code?: string;
  requestId?: string;
}): string {
  const code = json.code as StoryErrorCode | undefined;
  if (code && Object.values(StoryUploadErrorCode).includes(code)) {
    return storyErrorMessage(code, json.requestId);
  }
  if (json.error) return json.error;
  return storyErrorMessage(StoryUploadErrorCode.UNKNOWN, json.requestId);
}

export function StoryCreateModal({ open, onClose, onSuccess }: Props) {
  const titleId = useId();
  const recordRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [step, setStep] = useState<Step>("choose");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [durationUnknown, setDurationUnknown] = useState(false);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [captureHint, setCaptureHint] = useState("");

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  const reset = useCallback(() => {
    setStep("choose");
    setFile(null);
    setDuration(0);
    setDurationUnknown(false);
    setBusy(false);
    setProgress(0);
    setError("");
    setErrorCode("");
    setCaptureHint("");
    revokePreview();
    if (recordRef.current) recordRef.current.value = "";
    if (chooseRef.current) chooseRef.current.value = "";
  }, [revokePreview]);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stories");
        if (!res.ok) return;
        const data = (await res.json()) as { activeSeconds?: number };
        if (!cancelled) setActiveSeconds(data.activeSeconds || 0);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    queueMicrotask(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("button, [href], input, [tabindex]")
        ?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  async function readDuration(selected: File): Promise<number | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(selected);
      const video = document.createElement("video");
      video.preload = "metadata";
      const done = (value: number | null) => {
        URL.revokeObjectURL(url);
        resolve(value);
      };
      const timer = window.setTimeout(() => done(null), 4000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        const d = video.duration;
        if (!Number.isFinite(d) || d <= 0 || d === Infinity) done(null);
        else done(d);
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        done(null);
      };
      video.src = url;
    });
  }

  function validateClient(selected: File, dur: number | null): string | null {
    const mime = resolveStoryMime({
      mime: selected.type,
      filename: selected.name,
    });
    const okType =
      Boolean(mime) ||
      !selected.type ||
      ALLOWED_STORY_VIDEO_TYPES.has(selected.type) ||
      /\.(mp4|webm|mov|m4v)$/i.test(selected.name);
    if (!okType || (selected.type && !mime && !/\.(mp4|webm|mov|m4v)$/i.test(selected.name))) {
      if (selected.type && !mime) {
        return storyErrorMessage(StoryUploadErrorCode.UNSUPPORTED_FORMAT);
      }
    }
    if (!mime && selected.type && !ALLOWED_STORY_VIDEO_TYPES.has(selected.type)) {
      return storyErrorMessage(StoryUploadErrorCode.UNSUPPORTED_FORMAT);
    }
    if (!mime && !selected.type && !/\.(mp4|webm|mov|m4v)$/i.test(selected.name)) {
      return storyErrorMessage(StoryUploadErrorCode.UNSUPPORTED_FORMAT);
    }
    if (selected.size <= 0) return "Empty file.";
    if (selected.size > MAX_STORY_CLIP_BYTES) {
      return storyErrorMessage(StoryUploadErrorCode.FILE_TOO_LARGE);
    }
    if (dur !== null && dur > MAX_STORY_CLIP_SECONDS + 0.5) {
      return storyErrorMessage(StoryUploadErrorCode.DURATION_INVALID);
    }
    if (
      dur !== null &&
      activeSeconds + Math.round(dur) > MAX_ACTIVE_STORY_SECONDS
    ) {
      return storyErrorMessage(StoryUploadErrorCode.QUOTA_EXCEEDED);
    }
    return null;
  }

  async function acceptFile(selected: File) {
    setError("");
    setErrorCode("");
    setCaptureHint("");
    const dur = await readDuration(selected);
    const invalid = validateClient(selected, dur);
    if (invalid) {
      setError(invalid);
      return;
    }
    revokePreview();
    const url = URL.createObjectURL(selected);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setFile(selected);
    setDuration(dur || 0);
    setDurationUnknown(dur === null);
    setStep("preview");
  }

  async function capturePoster(selected: File): Promise<Blob | null> {
    try {
      const url = URL.createObjectURL(selected);
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => undefined);
      video.pause();
      video.currentTime = Math.min(0.4, (video.duration || 1) * 0.1);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(() => resolve(), 800);
      });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 1280;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return null;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      return await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82),
      );
    } catch {
      return null;
    }
  }

  async function confirmUpload() {
    if (!file || busy) return;
    const invalid = validateClient(file, durationUnknown ? null : duration);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setStep("uploading");
    setProgress(4);
    setError("");
    setErrorCode("");
    try {
      const poster = await capturePoster(file);
      setProgress(8);

      const mime =
        resolveStoryMime({ mime: file.type, filename: file.name }) ||
        file.type ||
        "video/mp4";

      const prepareRes = await fetch("/api/stories/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          filename: file.name,
          contentType: mime,
          size: file.size,
        }),
      });
      const prepareJson = (await prepareRes.json().catch(() => ({}))) as {
        ok?: boolean;
        pathname?: string;
        uploadSessionId?: string;
        contentType?: string;
        error?: string;
        code?: string;
        requestId?: string;
        useClientUpload?: boolean;
      };
      if (prepareRes.status === 401) {
        throw Object.assign(
          new Error(storyErrorMessage(StoryUploadErrorCode.AUTH_FAILED)),
          { code: StoryUploadErrorCode.AUTH_FAILED },
        );
      }
      if (!prepareRes.ok || !prepareJson.pathname || !prepareJson.uploadSessionId) {
        // Local/dev fallback: small proxy upload when client Blob tokens unavailable.
        if (prepareRes.status === 503 || prepareJson.code === StoryUploadErrorCode.STORAGE_FAILED) {
          await proxyUploadLegacy(file, poster);
          onSuccess();
          return;
        }
        throw Object.assign(new Error(messageFromResponse(prepareJson)), {
          code: prepareJson.code,
        });
      }

      setProgress(12);
      const blob = await upload(prepareJson.pathname, file, {
        access: "public",
        handleUploadUrl: "/api/stories/client-upload",
        contentType: prepareJson.contentType || mime,
        multipart: file.size > 5 * 1024 * 1024,
        clientPayload: JSON.stringify({
          uploadSessionId: prepareJson.uploadSessionId,
          size: file.size,
          contentType: prepareJson.contentType || mime,
          filename: file.name,
        }),
        onUploadProgress: (ev) => {
          setProgress(12 + Math.round((ev.percentage || 0) * 0.7));
        },
      });

      setProgress(86);
      const form = new FormData();
      form.append("pathname", blob.pathname);
      form.append("url", blob.url);
      form.append("contentType", prepareJson.contentType || mime);
      form.append("size", String(file.size));
      form.append("uploadSessionId", prepareJson.uploadSessionId);
      form.append("originalFilename", file.name || "");
      if (!durationUnknown && duration > 0) {
        form.append("durationSec", String(duration));
      }
      if (poster) form.append("poster", poster, "poster.jpg");

      const finRes = await fetch("/api/stories/finalize", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const finJson = (await finRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        code?: string;
        requestId?: string;
      };
      if (finRes.status === 401) {
        throw Object.assign(
          new Error(storyErrorMessage(StoryUploadErrorCode.AUTH_FAILED)),
          { code: StoryUploadErrorCode.AUTH_FAILED },
        );
      }
      if (!finRes.ok || !finJson.ok) {
        throw Object.assign(new Error(messageFromResponse(finJson)), {
          code: finJson.code,
          requestId: finJson.requestId,
        });
      }
      setProgress(100);
      onSuccess();
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code || "")
          : "";
      const requestId =
        err && typeof err === "object" && "requestId" in err
          ? String((err as { requestId?: string }).requestId || "")
          : "";
      let message =
        err instanceof Error ? err.message : storyErrorMessage(StoryUploadErrorCode.UNKNOWN);
      if (
        /Failed to fetch|NetworkError|Load failed|network/i.test(message) ||
        (err instanceof TypeError && /fetch/i.test(message))
      ) {
        message = storyErrorMessage(StoryUploadErrorCode.NETWORK, requestId);
      }
      setErrorCode(code);
      setError(message);
      setStep("preview");
    } finally {
      setBusy(false);
    }
  }

  async function proxyUploadLegacy(selected: File, poster: Blob | null) {
    const form = new FormData();
    form.append("file", selected);
    form.append(
      "durationSec",
      String(durationUnknown ? 1 : Math.max(1, duration)),
    );
    if (poster) form.append("poster", poster, "poster.jpg");
    const res = await fetch("/api/stories", {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      code?: string;
      requestId?: string;
    };
    if (!res.ok || !json.ok) {
      throw Object.assign(new Error(messageFromResponse(json)), {
        code: json.code,
        requestId: json.requestId,
      });
    }
  }

  function openRecord() {
    setError("");
    setErrorCode("");
    setCaptureHint(
      "If your browser cannot open the camera, record a short video with your device, then use Choose Video.",
    );
    recordRef.current?.click();
  }

  function openChoose() {
    setError("");
    setErrorCode("");
    setCaptureHint("");
    chooseRef.current?.click();
  }

  const remaining = Math.max(0, MAX_ACTIVE_STORY_SECONDS - activeSeconds);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(92svh,40rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/15 bg-[#071428] text-white shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-2xl">
              {step === "choose"
                ? "Add Story"
                : step === "preview"
                  ? "Preview Story"
                  : "Uploading"}
            </h2>
            {step === "choose" ? (
              <>
                <p className="mt-1.5 text-sm text-white/60">
                  Show people where you are and what you can access right now.
                </p>
                <p className="mt-1 text-xs text-electric/90">
                  Show us the local market.
                </p>
              </>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-2 text-white/50 hover:text-white disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <input
            ref={recordRef}
            type="file"
            accept={STORY_VIDEO_ACCEPT}
            capture="environment"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void acceptFile(f);
            }}
          />
          <input
            ref={chooseRef}
            type="file"
            accept={STORY_VIDEO_ACCEPT}
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void acceptFile(f);
            }}
          />

          {step === "choose" ? (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-white/45">
                {STORY_PRIVACY_NOTICE}
              </p>
              <p className="text-[11px] text-white/40">{STORY_FORMAT_HINT}</p>
              <p className="text-[11px] text-white/40">
                Active Story time remaining: {formatSeconds(remaining)} of 90
                minutes.
              </p>
              {captureHint ? (
                <p className="text-xs text-white/50">{captureHint}</p>
              ) : null}
              {error ? (
                <p className="text-sm text-red-300" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={openRecord}
                  className="min-h-12 rounded-lg bg-electric px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-white hover:bg-electric-hover"
                >
                  Record Story
                </button>
                <button
                  type="button"
                  onClick={openChoose}
                  className="min-h-12 rounded-lg border border-white/20 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/85 hover:border-white/40"
                >
                  Choose Video
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 py-2 text-xs uppercase tracking-[0.12em] text-white/45 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {(step === "preview" || step === "uploading") && file && previewUrl ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl bg-black">
                <video
                  ref={videoRef}
                  src={previewUrl}
                  controls
                  playsInline
                  className="mx-auto max-h-[min(46svh,22rem)] w-full bg-black object-contain"
                />
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-white/55">
                <div>
                  <dt className="uppercase tracking-[0.12em] text-white/35">
                    Duration
                  </dt>
                  <dd className="mt-0.5 text-white/85">
                    {durationUnknown
                      ? "Verified on upload"
                      : formatSeconds(duration)}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-white/35">
                    Size
                  </dt>
                  <dd className="mt-0.5 text-white/85">
                    {formatBytes(file.size)}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-white/35">
                    Type
                  </dt>
                  <dd className="mt-0.5 text-white/85">
                    {mimeLabel(
                      resolveStoryMime({
                        mime: file.type,
                        filename: file.name,
                      }) || file.type,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-white/35">
                    Allowance
                  </dt>
                  <dd className="mt-0.5 text-white/85">
                    {formatSeconds(activeSeconds)} / 90m used
                  </dd>
                </div>
              </dl>
              {durationUnknown ? (
                <p className="text-xs text-white/45">
                  Duration will be verified during upload.
                </p>
              ) : null}
              <p className="text-xs text-white/45">
                Stories are public and expire after 24 hours.
              </p>
              {error ? (
                <p className="text-sm text-red-300" role="alert">
                  {error}
                  {errorCode ? (
                    <span className="mt-1 block text-[11px] text-red-300/70">
                      {errorCode}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {step === "uploading" || busy ? (
                <div aria-live="polite">
                  <p className="text-xs text-white/55">
                    Uploading… {progress}%
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-electric transition-[width] motion-reduce:transition-none"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void confirmUpload()}
                    className="min-h-12 rounded-lg bg-electric px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-white hover:bg-electric-hover"
                  >
                    {error ? "Retry" : "Add to Story"}
                  </button>
                  <button
                    type="button"
                    onClick={openChoose}
                    className="min-h-11 rounded-lg border border-white/20 px-4 py-2.5 text-xs uppercase tracking-[0.12em] text-white/75 hover:border-white/40"
                  >
                    Choose Another Video
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      reset();
                      onClose();
                    }}
                    className="min-h-11 py-2 text-xs uppercase tracking-[0.12em] text-white/45 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
