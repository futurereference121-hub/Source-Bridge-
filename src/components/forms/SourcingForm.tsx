"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";

const initial = {
  name: "",
  email: "",
  country: "",
  business: "",
  productRequired: "",
  quantity: "",
  budget: "",
  additionalDetails: "",
};

export function SourcingForm() {
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">(
    "idle",
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch("/api/sourcing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error("Failed");
      setStatus("success");
      setValues(initial);
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="border border-border bg-surface p-8 sm:p-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-success">
          Request received
        </p>
        <h3 className="mt-3 font-display text-3xl text-ink">Thank you.</h3>
        <p className="mt-3 max-w-md text-muted">
          Our sourcing team will review your brief and respond shortly. You can also
          browse the shop while you wait.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-6"
          onClick={() => setStatus("idle")}
        >
          Submit another request
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="border border-border bg-surface p-6 sm:p-10">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Name"
          required
          value={values.name}
          onChange={(v) => setValues((s) => ({ ...s, name: v }))}
        />
        <Field
          label="Email"
          type="email"
          required
          value={values.email}
          onChange={(v) => setValues((s) => ({ ...s, email: v }))}
        />
        <Field
          label="Country"
          required
          value={values.country}
          onChange={(v) => setValues((s) => ({ ...s, country: v }))}
        />
        <Field
          label="Business"
          optional
          value={values.business}
          onChange={(v) => setValues((s) => ({ ...s, business: v }))}
        />
        <Field
          label="Product Required"
          required
          className="sm:col-span-2"
          value={values.productRequired}
          onChange={(v) => setValues((s) => ({ ...s, productRequired: v }))}
        />
        <Field
          label="Quantity"
          required
          value={values.quantity}
          onChange={(v) => setValues((s) => ({ ...s, quantity: v }))}
        />
        <Field
          label="Budget"
          required
          value={values.budget}
          onChange={(v) => setValues((s) => ({ ...s, budget: v }))}
        />
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Additional Details
          </label>
          <textarea
            rows={5}
            value={values.additionalDetails}
            onChange={(e) =>
              setValues((s) => ({ ...s, additionalDetails: e.target.value }))
            }
            className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm text-ink outline-none transition focus:border-accent"
          />
        </div>
      </div>

      {status === "error" ? (
        <p className="mt-4 text-sm text-red-700">
          Something went wrong. Please try again.
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="mt-8 w-full sm:w-auto"
        disabled={status === "submitting"}
      >
        {status === "submitting" ? "Sending…" : "Submit Sourcing Request"}
      </Button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  optional,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  optional?: boolean;
  type?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium uppercase tracking-[0.14em] text-muted">
        {label}
        {optional ? <span className="normal-case tracking-normal"> (optional)</span> : null}
      </label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm text-ink outline-none transition focus:border-accent"
      />
    </div>
  );
}
