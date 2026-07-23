"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";

export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "success">("idle");
  const [enquiryType, setEnquiryType] = useState("general");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("success");
  }

  if (status === "success") {
    return (
      <div className="border border-border bg-surface p-8 sm:p-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-success">
          Message sent
        </p>
        <h3 className="mt-3 font-display text-3xl text-ink">We&apos;ll be in touch.</h3>
        <p className="mt-3 text-muted">
          Thank you for contacting Source Bridge. Our team typically responds within one
          business day.
        </p>
        <Button type="button" variant="outline" className="mt-6" onClick={() => setStatus("idle")}>
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="border border-border bg-surface p-6 sm:p-10">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Name
          </label>
          <input
            required
            name="name"
            className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Email
          </label>
          <input
            required
            type="email"
            name="email"
            className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Enquiry type
          </label>
          <select
            value={enquiryType}
            onChange={(e) => setEnquiryType(e.target.value)}
            className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm outline-none focus:border-accent"
          >
            <option value="general">General business</option>
            <option value="retail">Retail partnership</option>
            <option value="sourcing">Product sourcing</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Message
          </label>
          <textarea
            required
            name="message"
            rows={5}
            className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm outline-none focus:border-accent"
          />
        </div>
      </div>
      <Button type="submit" size="lg" className="mt-8">
        Send Message
      </Button>
    </form>
  );
}
