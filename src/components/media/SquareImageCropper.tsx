"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cropImageToSquare } from "@/lib/client-image-upload";

const VIEWPORT = 280;
const PREVIEW = 72;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const DEFAULT_OUTPUT = 1024;

type Props = {
  /** Source File, or a blob/object URL string. */
  source: File | string;
  open: boolean;
  title?: string;
  outputSize?: number;
  onCancel: () => void;
  onConfirm: (file: File) => void | Promise<void>;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function clampOffsets(
  offsetX: number,
  offsetY: number,
  imgW: number,
  imgH: number,
  zoom: number,
  viewport: number,
) {
  const cover = Math.max(viewport / imgW, viewport / imgH);
  const scale = cover * zoom;
  const displayedW = imgW * scale;
  const displayedH = imgH * scale;
  const minX = viewport - displayedW;
  const minY = viewport - displayedH;
  // Centered dx/dy before pan: (viewport - displayed) / 2
  // Pan is added on top; clamp final position then convert back to offset.
  const baseX = (viewport - displayedW) / 2;
  const baseY = (viewport - displayedH) / 2;
  const dx = clamp(baseX + offsetX, minX, 0);
  const dy = clamp(baseY + offsetY, minY, 0);
  return { offsetX: dx - baseX, offsetY: dy - baseY };
}

export function SquareImageCropper({
  source,
  open,
  title = "Crop image",
  outputSize = DEFAULT_OUTPUT,
  onCancel,
  onConfirm,
}: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const sourceFile = useMemo(() => {
    if (typeof source !== "string") return source;
    return null;
  }, [source]);

  useEffect(() => {
    if (!open) return;

    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setImgSize(null);
    setError(null);
    setBusy(false);

    let url: string;
    let owned = false;
    if (typeof source === "string") {
      url = source;
    } else {
      url = URL.createObjectURL(source);
      owned = true;
    }
    setObjectUrl(url);

    return () => {
      if (owned) URL.revokeObjectURL(url);
    };
  }, [open, source]);

  const applyClamp = useCallback(
    (ox: number, oy: number, z: number) => {
      if (!imgSize) return { offsetX: ox, offsetY: oy };
      return clampOffsets(ox, oy, imgSize.w, imgSize.h, z, VIEWPORT);
    },
    [imgSize],
  );

  function onZoomChange(next: number) {
    const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
    setZoom(z);
    setOffset((prev) => {
      const c = applyClamp(prev.x, prev.y, z);
      return { x: c.offsetX, y: c.offsetY };
    });
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const c = applyClamp(drag.originX + dx, drag.originY + dy, zoom);
    setOffset({ x: c.offsetX, y: c.offsetY });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }

  const imageStyle = useMemo(() => {
    if (!imgSize || !objectUrl) return undefined;
    const cover = Math.max(VIEWPORT / imgSize.w, VIEWPORT / imgSize.h);
    const scale = cover * zoom;
    const displayedW = imgSize.w * scale;
    const displayedH = imgSize.h * scale;
    const left = (VIEWPORT - displayedW) / 2 + offset.x;
    const top = (VIEWPORT - displayedH) / 2 + offset.y;
    return {
      width: displayedW,
      height: displayedH,
      transform: `translate(${left}px, ${top}px)`,
    } as const;
  }, [imgSize, objectUrl, zoom, offset.x, offset.y]);

  const previewStyle = useMemo(() => {
    if (!imgSize || !objectUrl) return undefined;
    const ratio = PREVIEW / VIEWPORT;
    const cover = Math.max(VIEWPORT / imgSize.w, VIEWPORT / imgSize.h);
    const scale = cover * zoom * ratio;
    const displayedW = imgSize.w * scale;
    const displayedH = imgSize.h * scale;
    const left = ((VIEWPORT - imgSize.w * cover * zoom) / 2 + offset.x) * ratio;
    const top = ((VIEWPORT - imgSize.h * cover * zoom) / 2 + offset.y) * ratio;
    return {
      width: displayedW,
      height: displayedH,
      transform: `translate(${left}px, ${top}px)`,
    } as const;
  }, [imgSize, objectUrl, zoom, offset.x, offset.y]);

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let file = sourceFile;
      if (!file) {
        if (typeof source !== "string") throw new Error("No image to crop.");
        const res = await fetch(source);
        const blob = await res.blob();
        file = new File([blob], "image.jpg", {
          type: blob.type || "image/jpeg",
        });
      }
      const cropped = await cropImageToSquare(file, {
        zoom,
        offsetX: offset.x * (outputSize / VIEWPORT),
        offsetY: offset.y * (outputSize / VIEWPORT),
        outputSize,
        quality: 0.85,
      });
      await onConfirm(cropped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not crop image.");
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="panel-navy w-full max-w-md rounded-xl p-5 text-white shadow-xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl text-white sm:text-2xl">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-sm text-white/50 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        <p className="mt-1.5 text-sm text-white/55">
          Drag to reposition · zoom to frame a square crop
        </p>

        <div className="mt-5 flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center sm:gap-6">
          <div
            className="relative touch-none overflow-hidden rounded-lg border border-electric/40 bg-black/40"
            style={{ width: VIEWPORT, height: VIEWPORT }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {objectUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={objectUrl}
                alt=""
                draggable={false}
                className="absolute left-0 top-0 max-w-none select-none"
                style={imageStyle}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setImgSize({ w: el.naturalWidth, h: el.naturalHeight });
                }}
              />
            ) : null}
            <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/20" />
          </div>

          <div className="flex flex-col items-center gap-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/45">
              Preview
            </p>
            <div
              className="relative overflow-hidden rounded-lg border border-white/15 bg-white/5"
              style={{ width: PREVIEW, height: PREVIEW }}
            >
              {objectUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={objectUrl}
                  alt=""
                  draggable={false}
                  className="absolute left-0 top-0 max-w-none select-none"
                  style={previewStyle}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-white/55">
            <span>Zoom</span>
            <span>{zoom.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            disabled={busy || !imgSize}
            onChange={(e) => onZoomChange(Number(e.target.value))}
            className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-electric disabled:opacity-50"
          />
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || !imgSize}
            onClick={() => void handleConfirm()}
            className="inline-flex h-11 items-center rounded-lg bg-electric px-5 text-sm font-medium text-white hover:bg-electric-hover disabled:opacity-50"
          >
            {busy ? "Cropping…" : "Use photo"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex h-11 items-center rounded-lg border border-white/20 px-5 text-sm font-medium text-white hover:border-electric/50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
