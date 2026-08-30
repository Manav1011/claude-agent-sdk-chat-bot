import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { apiErrorMessage } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../Button";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
});

type FormValues = z.infer<typeof schema>;

export function SignInForm({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email.trim(), values.password);
      onAuthenticated();
    } catch (err) {
      setFormError(apiErrorMessage(err, "Unable to sign in. Please try again."));
      setFocus("password");
    }
  });

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {formError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}
        </div>
      )}
      <div>
        <label htmlFor="sign-in-email" className="mb-1 block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="sign-in-email"
          type="email"
          autoComplete="email"
          autoFocus
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "sign-in-email-error" : undefined}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600"
          {...register("email")}
        />
        {errors.email && (
          <p id="sign-in-email-error" className="mt-1 text-xs text-red-600">
            {errors.email.message}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="sign-in-password" className="mb-1 block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="sign-in-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? "sign-in-password-error" : undefined}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600"
          {...register("password")}
        />
        {errors.password && (
          <p id="sign-in-password-error" className="mt-1 text-xs text-red-600">
            {errors.password.message}
          </p>
        )}
      </div>
      <Button type="submit" loading={isSubmitting} className="w-full">
        {isSubmitting && <span className="sr-only">Signing in, </span>}
        Sign in
      </Button>
    </form>
  );
}
