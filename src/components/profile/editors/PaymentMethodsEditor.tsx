"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { ImageUploadField } from "@/components/profile/ImageUploadField";
import { useAppUi } from "@/components/providers/AppProviders";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import {
  EditorField,
  apiJson,
  editorInputClass,
  jsonBody,
} from "@/components/profile/editors/EditorShell";

type PaymentMethod = {
  id: string;
  kind: string;
  networkName: string;
  address: string;
  qrImageUrl: string;
  instructions: string;
  enabled: boolean;
  sortOrder: number;
};

const blankForm = {
  networkName: "",
  address: "",
  qrImageUrl: "",
  instructions: "",
  enabled: true,
};

export function PaymentMethodsEditor() {
  const { account, showToast } = useAppUi();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiJson("/api/payment-methods");
      setMethods(data.paymentMethods || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load methods");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiJson(
        "/api/payment-methods",
        jsonBody("POST", {
          kind: "crypto",
          networkName: form.networkName.trim(),
          address: form.address.trim(),
          qrImageUrl: form.qrImageUrl || "",
          instructions: form.instructions.trim(),
          enabled: form.enabled,
        }),
      );
      showToast("Payment method added");
      setForm(blankForm);
      setShowAdd(false);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not add method");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(method: PaymentMethod) {
    try {
      await apiJson(
        `/api/payment-methods/${method.id}`,
        jsonBody("PATCH", { enabled: !method.enabled }),
      );
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Remove this payment method?")) return;
    try {
      await apiJson(`/api/payment-methods/${id}`, { method: "DELETE" });
      showToast("Payment method removed");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (!account) {
    return <p className="text-sm text-white/45">Sign in to manage payment methods.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
          Crypto payment methods
        </h2>
        <p className="mt-2 text-sm text-white/55">
          Buyers can send crypto to these wallets at checkout. Never enter private
          keys or seed phrases — only public wallet addresses.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-white/45">Loading…</p>
      ) : methods.length === 0 && !showAdd ? (
        <p className="text-sm text-white/50">No crypto methods yet.</p>
      ) : (
        <ul className="space-y-3">
          {methods.map((m) => (
            <li
              key={m.id}
              className="rounded-lg border border-white/10 px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    {m.networkName}
                    {!m.enabled ? (
                      <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-white/40">
                        Disabled
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-white/55">
                    {m.address}
                  </p>
                  {m.instructions ? (
                    <p className="mt-2 text-xs text-white/45">{m.instructions}</p>
                  ) : null}
                </div>
                {m.qrImageUrl ? (
                  <div className="relative h-16 w-16 overflow-hidden rounded-md bg-white">
                    <Image
                      src={m.qrImageUrl}
                      alt="QR"
                      fill
                      className="object-contain p-1"
                      sizes="64px"
                    />
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void toggleEnabled(m)}
                  className="text-xs uppercase tracking-[0.14em] text-electric hover:text-electric-hover"
                >
                  {m.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(m.id)}
                  className="text-xs uppercase tracking-[0.14em] text-red-300/80 hover:text-red-200"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!showAdd ? (
        <PrimaryButton
          type="button"
          showArrow={false}
          className="rounded-lg"
          onClick={() => setShowAdd(true)}
        >
          Add crypto method
        </PrimaryButton>
      ) : (
        <form onSubmit={onAdd} className="space-y-3 rounded-lg border border-white/10 p-4">
          <EditorField label="Network">
            <input
              className={editorInputClass}
              value={form.networkName}
              onChange={(e) =>
                setForm({ ...form, networkName: e.target.value })
              }
              placeholder="Bitcoin, Ethereum, USDT…"
              required
              maxLength={80}
            />
          </EditorField>
          <EditorField label="Wallet address">
            <input
              className={editorInputClass}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Public address only"
              required
              minLength={10}
              maxLength={128}
            />
          </EditorField>
          <EditorField label="Instructions (optional)">
            <textarea
              className={`${editorInputClass} min-h-20 py-3`}
              value={form.instructions}
              onChange={(e) =>
                setForm({ ...form, instructions: e.target.value })
              }
              maxLength={2000}
              placeholder="Network fees, memo tags, etc."
            />
          </EditorField>
          <ImageUploadField
            label="QR code (optional)"
            folder="misc"
            kind="photo"
            value={form.qrImageUrl}
            userId={account.id}
            variant="cover"
            onUploaded={(url) => setForm({ ...form, qrImageUrl: url })}
            showToast={showToast}
            disabled={busy}
          />
          <label className="flex items-center gap-3 text-sm text-white/70">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) =>
                setForm({ ...form, enabled: e.target.checked })
              }
              className="h-4 w-4 rounded border-white/30 bg-transparent"
            />
            Enabled for checkout
          </label>
          <div className="flex flex-wrap gap-3 pt-1">
            <PrimaryButton
              type="submit"
              showArrow={false}
              disabled={busy}
              className="rounded-lg"
            >
              {busy ? "Saving…" : "Save method"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setForm(blankForm);
              }}
              className="text-xs uppercase tracking-[0.14em] text-white/45 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
